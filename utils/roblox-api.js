const axios = require('axios');

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 2000;

// Global rate limit tracking
let globalRateLimitUntil = 0;
let globalRateLimitActive = false;

// Authentication state
let csrfToken = null;
const roblosecurityCookie = process.env.ROBLOSECURITY_COOKIE;
let authenticatedUserId = null;

// Cookie status tracking
let cookieStatus = 'unknown';
let lastAuthSuccess = null;
let authFailureCount = 0;

// Configure base headers
const robloxHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Roblox/WinInet',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.roblox.com',
    'Referer': 'https://www.roblox.com/'
};

/**
 * Get headers with authentication
 */
function getAuthHeaders() {
    const headers = { ...robloxHeaders };
    
    if (roblosecurityCookie) {
        headers['Cookie'] = `.ROBLOSECURITY=${roblosecurityCookie}`;
        if (csrfToken) {
            headers['X-CSRF-TOKEN'] = csrfToken;
        }
    }
    
    return headers;
}

/**
 * Make a rate-limited Roblox API request
 */
async function makeRobloxRequest(requestFunc, requestName = 'Unknown') {
    // Check global rate limit
    if (globalRateLimitActive && Date.now() < globalRateLimitUntil) {
        const waitTime = Math.ceil((globalRateLimitUntil - Date.now()) / 1000);
        console.log(`⏳ Global rate limit active. Waiting ${waitTime} seconds for ${requestName}...`);
        await new Promise(resolve => setTimeout(resolve, globalRateLimitUntil - Date.now()));
    }
    
    try {
        const result = await requestFunc();
        // Reset global rate limit on successful request
        if (globalRateLimitActive) {
            globalRateLimitActive = false;
            console.log('✅ Global rate limit cleared');
        }
        return result;
    } catch (error) {
        // Handle rate limit responses
        if (error.response?.status === 429) {
            const retryAfter = error.response.headers['retry-after'];
            const waitSeconds = retryAfter ? parseInt(retryAfter) : 60;
            globalRateLimitUntil = Date.now() + (waitSeconds * 1000);
            globalRateLimitActive = true;
            console.log(`🚫 Global rate limit hit! Pausing ALL requests for ${waitSeconds} seconds`);
            
            // Return rate limit error for handling
            return { error: 'rate_limited', retryAfter: waitSeconds };
        }
        throw error;
    }
}

/**
 * Initialize authentication and get CSRF token
 */
async function initializeAuth() {
    if (!roblosecurityCookie) {
        console.log('⚠️ No ROBLOSECURITY cookie configured');
        cookieStatus = 'missing';
        return false;
    }
    
    try {
        // Get CSRF token via logout endpoint
        console.log('🔍 Initializing authentication...');
        await axios.post('https://auth.roblox.com/v2/logout', {}, {
            headers: {
                'Cookie': `.ROBLOSECURITY=${roblosecurityCookie}`
            },
            timeout: 10000
        });
    } catch (error) {
        if (error.response?.headers?.['x-csrf-token']) {
            csrfToken = error.response.headers['x-csrf-token'];
            console.log('✅ CSRF token obtained');
            
            // Get authenticated user info
            try {
                const userResponse = await axios.get('https://users.roblox.com/v1/users/authenticated', {
                    headers: getAuthHeaders(),
                    timeout: 10000
                });
                
                if (userResponse.data?.id) {
                    authenticatedUserId = userResponse.data.id;
                    cookieStatus = 'healthy';
                    lastAuthSuccess = new Date();
                    authFailureCount = 0;
                    console.log(`✅ Authenticated as user ${authenticatedUserId} (${userResponse.data.name})`);
                    return true;
                }
            } catch (userError) {
                console.log('❌ Failed to verify authentication:', userError.message);
                if (userError.response?.status === 401) {
                    cookieStatus = 'expired';
                } else {
                    cookieStatus = 'error';
                }
                authFailureCount++;
            }
        }
    }
    
    return false;
}

/**
 * Generate authenticated join with proper API call
 */
async function generateAuthenticatedJoin(placeId, gameId) {
    if (!roblosecurityCookie || !csrfToken) {
        console.log('⚠️ Authentication not available for direct join');
        return null;
    }
    
    const joinRequest = {
        placeId: parseInt(placeId),
        isTeleport: false,
        gameId: gameId,
        gameInstanceId: gameId
    };
    
    const result = await makeRobloxRequest(async () => {
        try {
            console.log(`🎯 Requesting authentication ticket for place ${placeId}, server ${gameId}`);
            
            const response = await axios.post(
                'https://gamejoin.roblox.com/v1/join-game-instance',
                joinRequest,
                {
                    headers: {
                        ...getAuthHeaders(),
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000,
                    validateStatus: () => true
                }
            );
            
            console.log(`📊 Join API Response Status: ${response.status}`);
            
            // SUCCESS CASES: Status 2 (game full) and others can still provide join data
            if (response.data?.joinScriptUrl) {
                const joinScriptUrl = response.data.joinScriptUrl;
                const webJoinUrl = `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameId}`;
                
                console.log('✅ Authentication ticket obtained!');
                return {
                    success: true,
                    protocolUrl: joinScriptUrl,
                    webUrl: webJoinUrl
                };
            }
            
            // Handle specific status codes
            if (response.data?.status === 6) {
                console.log('⚠️ Private server - authorization required');
                return { success: false, error: 'Private server' };
            } else if (response.data?.status === 10) {
                console.log('⚠️ Already in this game');
                return { success: false, error: 'Already in game' };
            } else if (response.data?.status === 12) {
                console.log('🔄 Authentication failure - refreshing token');
                
                if (response.headers?.['x-csrf-token']) {
                    csrfToken = response.headers['x-csrf-token'];
                    
                    // Retry once with new token
                    const retryResponse = await axios.post(
                        'https://gamejoin.roblox.com/v1/join-game-instance',
                        joinRequest,
                        {
                            headers: getAuthHeaders(),
                            timeout: 10000,
                            validateStatus: () => true
                        }
                    );
                    
                    if (retryResponse.data?.joinScriptUrl) {
                        const joinScriptUrl = retryResponse.data.joinScriptUrl;
                        const webJoinUrl = `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameId}`;
                        
                        return {
                            success: true,
                            protocolUrl: joinScriptUrl,
                            webUrl: webJoinUrl
                        };
                    }
                }
                
                return { success: false, error: 'Authentication failed' };
            }
            
            return { 
                success: false, 
                error: `Unexpected response format (status: ${response.data?.status || 'unknown'})` 
            };
            
        } catch (error) {
            console.error('❌ Join API error:', error.message);
            return { success: false, error: error.message };
        }
    }, 'generateAuthenticatedJoin');
    
    return result;
}

/**
 * Get Roblox User ID from username
 * FIXED: Returns consistent types - number for success, object for errors, null for not found
 */
async function getRobloxUserId(username) {
    const result = await makeRobloxRequest(async () => {
        try {
            console.log(`🔍 Looking up username: ${username}`);
            
            // Use direct username lookup instead of search
            const response = await axios.post(
                'https://users.roblox.com/v1/usernames/users',
                { 
                    usernames: [username],
                    excludeBannedUsers: true 
                },
                { 
                    headers: robloxHeaders, 
                    timeout: 10000 
                }
            );
            
            // Check if user was found
            if (response.data?.data && response.data.data.length > 0) {
                const user = response.data.data[0];
                
                if (user.id) {
                    console.log(`✅ Found user: ${user.name} (ID: ${user.id})`);
                    return user.id; // Return just the ID number
                }
            }
            
            console.log(`❌ User not found: ${username}`);
            return null;
            
        } catch (error) {
            // Handle specific error cases
            if (error.response?.status === 400) {
                console.log(`❌ Invalid username format: ${username}`);
                return null;
            }
            
            console.log(`❌ Error looking up ${username}: ${error.message}`);
            return null;
        }
    }, `getRobloxUserId(${username})`);
    
    return result;
}

/**
 * Get player presence data
 */
async function getPlayerPresence(userId) {
    console.log(`🔍 Getting presence for user ${userId}`);
    
    const result = await makeRobloxRequest(async () => {
        try {
            // Try authenticated request first
            if (roblosecurityCookie && csrfToken) {
                try {
                    const authResponse = await axios.post(
                        'https://presence.roblox.com/v1/presence/users',
                        { userIds: [userId] },
                        { headers: getAuthHeaders(), timeout: 10000 }
                    );
                    
                    const presence = authResponse.data.userPresences?.[0];
                    if (presence) {
                        console.log('✅ Got authenticated presence data');
                        lastAuthSuccess = new Date();
                        cookieStatus = 'healthy';
                        return presence;
                    }
                } catch (authError) {
                    // Handle CSRF refresh
                    if (authError.response?.status === 403 && authError.response?.headers?.['x-csrf-token']) {
                        csrfToken = authError.response.headers['x-csrf-token'];
                        
                        const retryResponse = await axios.post(
                            'https://presence.roblox.com/v1/presence/users',
                            { userIds: [userId] },
                            { headers: getAuthHeaders(), timeout: 10000 }
                        );
                        
                        const presence = retryResponse.data.userPresences?.[0];
                        if (presence) {
                            console.log('✅ Got presence after CSRF refresh');
                            return presence;
                        }
                    }
                    
                    if (authError.response?.status === 401) {
                        cookieStatus = 'expired';
                        console.log('🚨 Cookie expired!');
                    }
                }
            }
            
            // Fallback to unauthenticated
            console.log('⚠️ Using unauthenticated presence request');
            const response = await axios.post(
                'https://presence.roblox.com/v1/presence/users',
                { userIds: [userId] },
                { headers: robloxHeaders, timeout: 10000 }
            );
            
            return response.data.userPresences?.[0] || null;
        } catch (error) {
            console.log(`❌ Presence request failed: ${error.message}`);
            return null;
        }
    }, `getPlayerPresence(${userId})`);
    
    // Check if we got a rate limit error
    if (result && result.error === 'rate_limited') {
        return null;
    }
    
    return result;
}

/**
 * Generate join URL with authentication
 * UPDATED: Always provides console script when gameId exists (for joins disabled bypass)
 */
async function generateJoinUrl(userId, presence) {
    const result = {
        authenticated: null,
        console: null,
        basic: null,
        authFailed: false
    };
    
    if (!presence.placeId) {
        return result;
    }
    
    // Try authenticated join if we have gameId and cookie
    if (presence.gameId && roblosecurityCookie) {
        const authJoin = await generateAuthenticatedJoin(presence.placeId, presence.gameId);
        if (authJoin?.success) {
            result.authenticated = authJoin.webUrl;
            console.log('✅ Generated authenticated join URL');
            // Don't provide console as backup when auth works
        } else {
            // Authentication failed - likely joins disabled (not private server)
            console.log(`⚠️ Auth failed - assuming joins disabled, providing console script`);
            result.authFailed = true;
            // Still provide console script since it usually works when joins are disabled
            result.console = `Roblox.GameLauncher.joinGameInstance(${presence.placeId}, "${presence.gameId}")`;
        }
    } else if (presence.gameId) {
        // No authentication but have gameId - provide console script
        result.console = `Roblox.GameLauncher.joinGameInstance(${presence.placeId}, "${presence.gameId}")`;
        console.log('✅ Generated console script (no auth available)');
    }
    
    // Never provide the basic "random server" URL
    return result;
}

/**
 * Check user's online status
 * UPDATED: Better handling of joins disabled vs private servers
 */
async function checkRobloxStatus(userId) {
    try {
        const presence = await getPlayerPresence(userId);
        
        if (!presence) {
            return {
                online: null,
                status: 'Account Private or Not Found',
                game: null,
                joinUrls: null,
                error: true,
                joinsDisabled: false
            };
        }
        
        console.log('Raw presence data:', JSON.stringify(presence, null, 2));
        
        const presenceType = presence.userPresenceType;
        let status, game = null, joinUrls = null, joinsDisabled = false;
        
        switch(presenceType) {
            case 0:
                status = 'Offline';
                break;
                
            case 1:
                status = 'Online';
                game = 'Not in game';
                break;
                
            case 2:
                // User is in-game
                status = 'Online';
                
                // Check if we can get join info
                if (!presence.placeId || !presence.gameId) {
                    // No game data - maximum privacy settings
                    game = 'In Game (Details Hidden)';
                    joinUrls = null;
                } else {
                    // We have game data
                    game = presence.lastLocation || `Playing (Place ID: ${presence.placeId})`;
                    joinUrls = await generateJoinUrl(userId, presence);
                    
                    // Check if joins are disabled (auth failed but we have gameId)
                    if (joinUrls.authFailed && joinUrls.console) {
                        joinsDisabled = true;
                        console.log('✅ Detected: Joins disabled but console method available');
                    }
                }
                break;
                
            case 3:
                status = 'Online';
                game = 'Roblox Studio';
                break;
                
            case 4:
                status = 'Account Private';
                break;
                
            default:
                status = 'Unknown';
        }
        
        return {
            online: presenceType === 1 || presenceType === 2 || presenceType === 3,
            status: status,
            game: game,
            joinUrls: joinUrls,
            error: false,
            hasAuthentication: !!joinUrls?.authenticated,
            joinsDisabled: joinsDisabled,
            presenceData: presence
        };

    } catch (error) {
        console.error(`❌ Status check error: ${error.message}`);
        return {
            online: null,
            status: 'API Error',
            game: null,
            joinUrls: null,
            error: true,
            joinsDisabled: false
        };
    }
}

/**
 * Rate limiting functions
 */
function checkRateLimit(userId) {
    const now = Date.now();
    const lastRequest = rateLimitMap.get(userId);
    
    if (lastRequest && now - lastRequest < RATE_LIMIT_MS) {
        return false;
    }
    
    rateLimitMap.set(userId, now);
    return true;
}

function getRemainingCooldown(userId) {
    const now = Date.now();
    const lastRequest = rateLimitMap.get(userId);
    
    if (!lastRequest) return 0;
    
    const remaining = RATE_LIMIT_MS - (now - lastRequest);
    return Math.max(0, remaining);
}

/**
 * Check cookie health - compatible with maintenance.js
 */
async function checkCookieHealth() {
    if (!roblosecurityCookie) {
        cookieStatus = 'missing';
        console.log('❌ No ROBLOSECURITY cookie found');
        return false;
    }

    const result = await makeRobloxRequest(async () => {
        try {
            // Ensure we have CSRF token
            if (!csrfToken) {
                await initializeAuth();
            }

            console.log('🔍 Testing cookie with authenticated endpoint...');
            const response = await axios.get('https://users.roblox.com/v1/users/authenticated', {
                headers: getAuthHeaders(),
                timeout: 10000
            });

            if (response.status === 200 && response.data?.id) {
                lastAuthSuccess = new Date();
                authFailureCount = 0;
                cookieStatus = 'healthy';
                authenticatedUserId = response.data.id;
                console.log(`✅ Cookie is healthy! Authenticated as user ${response.data.id} (${response.data.name})`);
                return true;
            }
        } catch (error) {
            authFailureCount++;
            
            if (error.response?.status === 401) {
                cookieStatus = 'expired';
                console.log('🚨 COOKIE EXPIRED! Need to get a new one from Roblox');
            } else if (error.response?.status === 403) {
                // Try refreshing CSRF token
                if (error.response?.headers?.['x-csrf-token']) {
                    csrfToken = error.response.headers['x-csrf-token'];
                    console.log('🔄 CSRF token refreshed, retrying...');
                    
                    try {
                        const retryResponse = await axios.get('https://users.roblox.com/v1/users/authenticated', {
                            headers: getAuthHeaders(),
                            timeout: 10000
                        });
                        
                        if (retryResponse.status === 200 && retryResponse.data?.id) {
                            lastAuthSuccess = new Date();
                            authFailureCount = 0;
                            cookieStatus = 'healthy';
                            authenticatedUserId = retryResponse.data.id;
                            console.log(`✅ Cookie healthy after CSRF refresh!`);
                            return true;
                        }
                    } catch (retryError) {
                        console.log(`❌ Retry failed: ${retryError.message}`);
                    }
                }
            } else {
                cookieStatus = 'error';
                console.log(`❌ Cookie test failed: ${error.message}`);
            }
            
            return false;
        }
        
        return false;
    }, 'checkCookieHealth');
    
    // Handle rate limit
    if (result && result.error === 'rate_limited') {
        return false;
    }
    
    return result || false;
}

/**
 * Get cookie status for maintenance monitoring
 */
function getCookieStatus() {
    const timeSinceSuccess = lastAuthSuccess ? 
        Math.floor((Date.now() - lastAuthSuccess.getTime()) / (1000 * 60 * 60)) : null;

    return {
        status: cookieStatus,
        lastSuccess: lastAuthSuccess,
        hoursSinceSuccess: timeSinceSuccess,
        failureCount: authFailureCount,
        needsMaintenance: cookieStatus === 'expired' || authFailureCount >= 3,
        authenticated: !!authenticatedUserId,
        userId: authenticatedUserId
    };
}

// Initialize authentication on module load
initializeAuth().then(success => {
    if (success) {
        console.log('✅ Authentication initialized successfully');
    } else {
        console.log('⚠️ Running in limited mode (no authentication)');
    }
});

module.exports = {
    getRobloxUserId,
    checkRobloxStatus,
    checkRateLimit,
    getRemainingCooldown,
    getCookieStatus,
    checkCookieHealth,
    initializeAuth,
    RATE_LIMIT_MS
};