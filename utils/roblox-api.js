const axios = require('axios');

// Rate limiting to avoid API abuse
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 5000; // 5 seconds between requests per user

// Cookie authentication state
let csrfToken = null;
const roblosecurityCookie = process.env.ROBLOSECURITY_COOKIE;

// Cookie health tracking
let lastAuthSuccess = null;
let authFailureCount = 0;
let cookieStatus = 'unknown';

// Configure headers for Roblox API requests
const robloxHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'WarrantBot/1.0',
    'Accept': 'application/json'
};

// Enhanced headers with authentication
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
 * Get CSRF token for authenticated requests
 */
async function getCsrfToken() {
    if (!roblosecurityCookie) return null;
    
    try {
        console.log('🔑 Getting CSRF token...');
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
            return csrfToken;
        }
        console.log('❌ Failed to get CSRF token:', error.message);
    }
    return null;
}

/**
 * Test cookie health and update status
 */
async function checkCookieHealth() {
    if (!roblosecurityCookie) {
        cookieStatus = 'missing';
        console.log('❌ No ROBLOSECURITY cookie found');
        return false;
    }

    try {
        // Ensure we have CSRF token
        if (!csrfToken) {
            await getCsrfToken();
        }

        console.log('🔍 Testing cookie with authenticated endpoint...');
        // Test with authenticated user info endpoint
        const response = await axios.get('https://users.roblox.com/v1/users/authenticated', {
            headers: getAuthHeaders(),
            timeout: 10000
        });

        if (response.status === 200) {
            lastAuthSuccess = new Date();
            authFailureCount = 0;
            cookieStatus = 'healthy';
            console.log(`✅ Cookie is healthy! Authenticated as user ${response.data.id} (${response.data.name})`);
            return true;
        }
    } catch (error) {
        authFailureCount++;
        
        if (error.response?.status === 401) {
            cookieStatus = 'expired';
            console.log('🚨 COOKIE EXPIRED! Need to get a new one from Roblox');
        } else {
            cookieStatus = 'error';
            console.log(`❌ Cookie test failed: ${error.message}`);
        }
        
        return false;
    }
    
    return false;
}

/**
 * Get cookie status for admin monitoring
 */
function getCookieStatus() {
    const timeSinceSuccess = lastAuthSuccess ? 
        Math.floor((Date.now() - lastAuthSuccess.getTime()) / (1000 * 60 * 60)) : null;

    return {
        status: cookieStatus,
        lastSuccess: lastAuthSuccess,
        hoursSinceSuccess: timeSinceSuccess,
        failureCount: authFailureCount,
        needsMaintenance: cookieStatus === 'expired' || authFailureCount >= 3
    };
}

/**
 * Get Roblox User ID from username using search API
 */
async function getRobloxUserId(username) {
    try {
        console.log(`🔍 Looking up username: ${username}`);
        
        // Try the search method first
        const searchResponse = await axios.get(
            `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=10`,
            { headers: robloxHeaders, timeout: 10000 }
        );
        
        if (searchResponse.data.data && searchResponse.data.data.length > 0) {
            // Look for exact match first
            const exactMatch = searchResponse.data.data.find(user => 
                user.name.toLowerCase() === username.toLowerCase()
            );
            
            if (exactMatch) {
                console.log(`✅ Found user: ${exactMatch.name} (ID: ${exactMatch.id})`);
                return exactMatch.id;
            }
            
            // If no exact match, use the first result
            const firstResult = searchResponse.data.data[0];
            console.log(`⚠️ Using closest match: ${firstResult.name} (ID: ${firstResult.id})`);
            return firstResult.id;
        }

        // Fallback to the old usernames method
        console.log('🔄 Trying fallback username API...');
        const usernamesResponse = await axios.post('https://users.roblox.com/v1/usernames/users', {
            usernames: [username],
            excludeBannedUsers: false
        }, { headers: robloxHeaders, timeout: 10000 });
        
        if (usernamesResponse.data.data && usernamesResponse.data.data.length > 0) {
            const userId = usernamesResponse.data.data[0].id;
            console.log(`✅ Found via fallback: ${username} (ID: ${userId})`);
            return userId;
        }
        
        console.log(`❌ User not found: ${username}`);
        return null;
    } catch (error) {
        console.log(`❌ Error looking up ${username}: ${error.message}`);
        return null;
    }
}

/**
 * Get player presence data with DEBUG LOGGING
 */
async function getPlayerPresence(userId) {
    console.log(`\n🔍 === GETTING PRESENCE FOR USER ${userId} ===`);
    
    try {
        // Try authenticated request first if available
        if (roblosecurityCookie) {
            console.log('🔐 Attempting authenticated request...');
            
            // Ensure we have CSRF token
            if (!csrfToken) {
                await getCsrfToken();
            }
            
            try {
                const authResponse = await axios.post(
                    'https://presence.roblox.com/v1/presence/users',
                    { userIds: [userId] },
                    { headers: getAuthHeaders(), timeout: 10000 }
                );
                
                // Mark successful auth
                lastAuthSuccess = new Date();
                authFailureCount = 0;
                cookieStatus = 'healthy';
                
                const presence = authResponse.data.userPresences?.[0];
                if (presence) {
                    console.log('✅ AUTHENTICATED REQUEST SUCCESS!');
                    console.log('🔍 === RAW PRESENCE DATA ===');
                    console.log(JSON.stringify(presence, null, 2));
                    console.log('🔍 === END RAW DATA ===\n');
                } else {
                    console.log('❌ Authenticated request returned no presence data');
                }
                
                return presence || null;
            } catch (authError) {
                console.log(`❌ Authenticated request failed: ${authError.message}`);
                
                // Handle CSRF token refresh
                if (authError.response?.status === 403 && authError.response?.headers?.['x-csrf-token']) {
                    console.log('🔄 Refreshing CSRF token and retrying...');
                    csrfToken = authError.response.headers['x-csrf-token'];
                    
                    try {
                        const retryResponse = await axios.post(
                            'https://presence.roblox.com/v1/presence/users',
                            { userIds: [userId] },
                            { headers: getAuthHeaders(), timeout: 10000 }
                        );
                        
                        // Mark successful auth after retry
                        lastAuthSuccess = new Date();
                        authFailureCount = 0;
                        cookieStatus = 'healthy';
                        
                        const presence = retryResponse.data.userPresences?.[0];
                        if (presence) {
                            console.log('✅ RETRY SUCCESS after CSRF refresh!');
                            console.log('🔍 === RAW PRESENCE DATA (RETRY) ===');
                            console.log(JSON.stringify(presence, null, 2));
                            console.log('🔍 === END RAW DATA ===\n');
                        }
                        
                        return presence || null;
                    } catch (retryError) {
                        console.log(`❌ CSRF retry failed: ${retryError.message}`);
                    }
                }
                
                // Check if cookie expired
                if (authError.response?.status === 401) {
                    cookieStatus = 'expired';
                    console.log('🚨 COOKIE EXPIRED! Get a new .ROBLOSECURITY cookie!');
                }
                
                // Track auth failures
                authFailureCount++;
            }
        }
        
        // Fallback: Unauthenticated request
        console.log('⚠️ Falling back to unauthenticated request...');
        const response = await axios.post(
            'https://presence.roblox.com/v1/presence/users',
            { userIds: [userId] },
            { headers: robloxHeaders, timeout: 10000 }
        );
        
        const presence = response.data.userPresences?.[0];
        if (presence) {
            console.log('⚠️ UNAUTHENTICATED REQUEST (LIMITED DATA):');
            console.log('🔍 === RAW PRESENCE DATA (UNAUTH) ===');
            console.log(JSON.stringify(presence, null, 2));
            console.log('🔍 === END RAW DATA ===\n');
        } else {
            console.log('❌ Unauthenticated request also failed');
        }
        
        return presence || null;
    } catch (error) {
        console.log(`❌ ALL PRESENCE REQUESTS FAILED: ${error.message}`);
        return null;
    }
}

/**
 * Generate primary join URL for FBI operations
 */
function generateJoinUrl(userId, presence) {
    console.log(`🔗 Generating join URL...`);
    console.log(`   - PlaceId: ${presence.placeId || 'None'}`);
    console.log(`   - RootPlaceId: ${presence.rootPlaceId || 'None'}`);
    
    // Priority order for most reliable joining:
    
    // 1. Direct join using placeId (most reliable for same server)
    if (presence.placeId) {
        const url = `https://www.roblox.com/games/start?placeId=${presence.placeId}&launchData=${userId}`;
        console.log(`✅ Generated direct place join: ${url}`);
        return url;
    }
    
    // 2. Root place join
    if (presence.rootPlaceId) {
        const url = `https://www.roblox.com/games/start?placeId=${presence.rootPlaceId}&launchData=${userId}`;
        console.log(`✅ Generated root place join: ${url}`);
        return url;
    }
    
    // 3. Social follow (always works)
    const url = `https://www.roblox.com/games/start?placeId=0&launchData=follow%3A${userId}`;
    console.log(`✅ Generated follow join: ${url}`);
    return url;
}

/**
 * Check user's online status with DEBUG LOGGING
 */
async function checkRobloxStatus(userId) {
    try {
        console.log(`\n🕵️ === STARTING STATUS CHECK FOR USER ${userId} ===`);
        const presence = await getPlayerPresence(userId);
        
        if (!presence) {
            console.log(`❌ No presence data - returning error state`);
            return {
                online: null,
                status: 'Account Private or Not Found',
                game: null,
                joinUrl: null,
                error: true
            };
        }
        
        const presenceType = presence.userPresenceType;
        console.log(`📊 Presence Type: ${presenceType}`);
        
        let status, game = null, joinUrl = null;
        
        switch(presenceType) {
            case 0: // Offline
                status = 'Offline';
                console.log(`🔴 User is OFFLINE`);
                break;
                
            case 1: // Online
                status = 'Online';
                game = 'Not in game';
                console.log(`🟢 User is ONLINE but not in game`);
                break;
                
            case 2: // In Game
                status = 'Online';
                console.log(`🎮 User is IN GAME`);
                
                // Get game name from available data
                console.log(`🔍 Checking game name sources:`);
                console.log(`   - lastLocation: "${presence.lastLocation || 'None'}"`);
                console.log(`   - universeId: ${presence.universeId || 'None'}`);
                console.log(`   - placeId: ${presence.placeId || 'None'}`);
                
                if (presence.lastLocation && presence.lastLocation.trim()) {
                    game = presence.lastLocation;
                    console.log(`✅ Using lastLocation: "${game}"`);
                } else if (presence.universeId) {
                    game = `Playing a game (Universe: ${presence.universeId})`;
                    console.log(`⚠️ Using universeId fallback: "${game}"`);
                } else {
                    game = 'Playing a game (details hidden)';
                    console.log(`❌ No game details available: "${game}"`);
                }
                
                // Generate join URL for agents
                joinUrl = generateJoinUrl(userId, presence);
                break;
                
            case 3: // In Studio
                status = 'Online';
                game = 'Roblox Studio';
                console.log(`🔧 User is in STUDIO`);
                break;
                
            case 4: // Invisible
                status = 'Account Private';
                console.log(`🔒 Account is PRIVATE`);
                break;
                
            default:
                status = 'Unknown';
                console.log(`❓ UNKNOWN presence type: ${presenceType}`);
        }
        
        const result = {
            online: presenceType === 1 || presenceType === 2 || presenceType === 3,
            status: status,
            game: game,
            joinUrl: joinUrl,
            error: false
        };
        
        console.log(`✅ === FINAL RESULT ===`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Game: ${result.game || 'None'}`);
        console.log(`   Join URL: ${result.joinUrl ? 'Generated' : 'None'}`);
        console.log(`=== END STATUS CHECK ===\n`);
        
        return result;

    } catch (error) {
        console.error(`❌ CRITICAL ERROR in status check: ${error.message}`);
        return {
            online: null,
            status: 'API Error',
            game: null,
            joinUrl: null,
            error: true
        };
    }
}

/**
 * Check if user can make a request (rate limiting)
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

/**
 * Get remaining cooldown time for a user
 */
function getRemainingCooldown(userId) {
    const now = Date.now();
    const lastRequest = rateLimitMap.get(userId);
    
    if (!lastRequest) return 0;
    
    const remaining = RATE_LIMIT_MS - (now - lastRequest);
    return Math.max(0, remaining);
}

module.exports = {
    getRobloxUserId,
    checkRobloxStatus,
    checkRateLimit,
    getRemainingCooldown,
    checkCookieHealth,
    getCookieStatus,
    RATE_LIMIT_MS
};