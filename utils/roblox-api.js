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
        await axios.post('https://auth.roblox.com/v2/logout', {}, {
            headers: {
                'Cookie': `.ROBLOSECURITY=${roblosecurityCookie}`
            },
            timeout: 10000
        });
    } catch (error) {
        if (error.response?.headers?.['x-csrf-token']) {
            csrfToken = error.response.headers['x-csrf-token'];
            return csrfToken;
        }
    }
    return null;
}

/**
 * Test cookie health and update status
 */
async function checkCookieHealth() {
    if (!roblosecurityCookie) {
        cookieStatus = 'missing';
        return false;
    }

    try {
        // Ensure we have CSRF token
        if (!csrfToken) {
            await getCsrfToken();
        }

        // Test with authenticated user info endpoint
        const response = await axios.get('https://users.roblox.com/v1/users/authenticated', {
            headers: getAuthHeaders(),
            timeout: 10000
        });

        if (response.status === 200) {
            lastAuthSuccess = new Date();
            authFailureCount = 0;
            cookieStatus = 'healthy';
            return true;
        }
    } catch (error) {
        authFailureCount++;
        
        if (error.response?.status === 401) {
            cookieStatus = 'expired';
        } else {
            cookieStatus = 'error';
        }
        
        console.log(`🚨 Cookie health check failed (${authFailureCount} failures)`);
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
 * @param {string} username - The Roblox username
 * @returns {Promise<number|null>} - User ID or null if not found
 */
async function getRobloxUserId(username) {
    try {
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
                return exactMatch.id;
            }
            
            // If no exact match, use the first result
            const firstResult = searchResponse.data.data[0];
            return firstResult.id;
        }

        // Fallback to the old usernames method
        const usernamesResponse = await axios.post('https://users.roblox.com/v1/usernames/users', {
            usernames: [username],
            excludeBannedUsers: false
        }, { headers: robloxHeaders, timeout: 10000 });
        
        if (usernamesResponse.data.data && usernamesResponse.data.data.length > 0) {
            return usernamesResponse.data.data[0].id;
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Get player presence data with authentication and health monitoring
 * @param {number} userId - The Roblox user ID
 * @returns {Promise<Object|null>} - Presence data or null
 */
async function getPlayerPresence(userId) {
    try {
        // Try authenticated request first if available
        if (roblosecurityCookie) {
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
                
                return authResponse.data.userPresences?.[0] || null;
            } catch (authError) {
                // Track auth failures
                authFailureCount++;
                
                // Handle CSRF token refresh
                if (authError.response?.status === 403 && authError.response?.headers?.['x-csrf-token']) {
                    csrfToken = authError.response.headers['x-csrf-token'];
                    
                    const retryResponse = await axios.post(
                        'https://presence.roblox.com/v1/presence/users',
                        { userIds: [userId] },
                        { headers: getAuthHeaders(), timeout: 10000 }
                    );
                    
                    // Mark successful auth after retry
                    lastAuthSuccess = new Date();
                    authFailureCount = 0;
                    cookieStatus = 'healthy';
                    
                    return retryResponse.data.userPresences?.[0] || null;
                }
                
                // Check if cookie expired
                if (authError.response?.status === 401) {
                    cookieStatus = 'expired';
                    console.log('🚨 ALERT: Cookie appears to have expired!');
                }
                
                // Fall back to unauthenticated if auth fails
            }
        }
        
        // Fallback: Unauthenticated request
        const response = await axios.post(
            'https://presence.roblox.com/v1/presence/users',
            { userIds: [userId] },
            { headers: robloxHeaders, timeout: 10000 }
        );
        
        return response.data.userPresences?.[0] || null;
    } catch (error) {
        return null;
    }
}

/**
 * Generate primary join URL for FBI operations
 * @param {number} userId - The Roblox user ID
 * @param {Object} presence - The presence data
 * @returns {string|null} - Best join URL or null
 */
function generateJoinUrl(userId, presence) {
    // Priority order for most reliable joining:
    
    // 1. Direct join using placeId (most reliable for same server)
    if (presence.placeId) {
        return `https://www.roblox.com/games/start?placeId=${presence.placeId}&launchData=${userId}`;
    }
    
    // 2. Root place join
    if (presence.rootPlaceId) {
        return `https://www.roblox.com/games/start?placeId=${presence.rootPlaceId}&launchData=${userId}`;
    }
    
    // 3. Social follow (always works)
    return `https://www.roblox.com/games/start?placeId=0&launchData=follow%3A${userId}`;
}

/**
 * Check user's online status (SIMPLIFIED FOR FBI OPERATIONS)
 * @param {number} userId - The Roblox user ID
 * @returns {Promise<Object>} - Clean status object
 */
async function checkRobloxStatus(userId) {
    try {
        const presence = await getPlayerPresence(userId);
        
        if (!presence) {
            return {
                online: null,
                status: 'Account Private or Not Found',
                game: null,
                joinUrl: null,
                error: true
            };
        }
        
        const presenceType = presence.userPresenceType;
        let status, game = null, joinUrl = null;
        
        switch(presenceType) {
            case 0: // Offline
                status = 'Offline';
                break;
                
            case 1: // Online
                status = 'Online';
                game = 'Not in game';
                break;
                
            case 2: // In Game
                status = 'Online';
                
                // Get game name from available data
                if (presence.lastLocation && presence.lastLocation.trim()) {
                    game = presence.lastLocation;
                } else if (presence.universeId) {
                    game = `Playing a game (Universe: ${presence.universeId})`;
                } else {
                    game = 'Playing a game (details hidden)';
                }
                
                // Generate join URL for agents
                joinUrl = generateJoinUrl(userId, presence);
                break;
                
            case 3: // In Studio
                status = 'Online';
                game = 'Roblox Studio';
                break;
                
            case 4: // Invisible
                status = 'Account Private';
                break;
                
            default:
                status = 'Unknown';
        }
        
        return {
            online: presenceType === 1 || presenceType === 2 || presenceType === 3,
            status: status,
            game: game,
            joinUrl: joinUrl,
            error: false
        };

    } catch (error) {
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
 * @param {string} userId - Discord user ID
 * @returns {boolean} - True if request allowed
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
 * @param {string} userId - Discord user ID
 * @returns {number} - Remaining cooldown in milliseconds
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