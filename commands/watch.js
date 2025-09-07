const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRobloxUserId, checkRobloxStatus } = require('../utils/roblox-api');
const { checkPermissionSilent } = require('../utils/permissions');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Watch data file path - stored in system temp directory for security
const WATCH_DATA_FILE = path.join(os.tmpdir(), 'warrant-bot-watches.json');

// Active watches (in memory)
const activeWatches = new Map();

// Interval constants
const INTERVAL_ONLINE = 60000;      // 1 minute when online
const INTERVAL_OFFLINE = 600000;    // 10 minutes when offline
const MAX_RETRIES = 3;              // Max retries for failed checks
const MAX_CONCURRENT_WATCHES = 20;  // Maximum watches allowed at once

// Ensure data directory exists (for temp directory)
async function ensureDataDir() {
    // Using temp directory, no need to create subdirectories
    try {
        // Just verify we can access the temp directory
        await fs.access(os.tmpdir());
    } catch (error) {
        console.error('Unable to access temp directory:', error);
    }
}

// Load watches from file
async function loadWatches() {
    try {
        await ensureDataDir();
        const data = await fs.readFile(WATCH_DATA_FILE, 'utf8');
        const watches = JSON.parse(data);
        
        // Restore active watches
        for (const watch of watches) {
            if (new Date(watch.endTime) > new Date()) {
                activeWatches.set(watch.username, watch);
                startWatching(watch);
            }
        }
        
        console.log(`📂 Loaded ${activeWatches.size} active watches from file`);
    } catch (error) {
        // File doesn't exist or is invalid
        console.log('📂 No existing watch data found');
    }
}

// Save watches to file
async function saveWatches() {
    try {
        await ensureDataDir();
        const watches = Array.from(activeWatches.values()).map(watch => ({
            username: watch.username,
            robloxUserId: watch.robloxUserId,
            startedBy: watch.startedBy,
            startedById: watch.startedById,
            guildId: watch.guildId,
            startTime: watch.startTime,
            endTime: watch.endTime,
            wasOnline: watch.wasOnline,
            consecutiveErrors: watch.consecutiveErrors || 0
        }));
        await fs.writeFile(WATCH_DATA_FILE, JSON.stringify(watches, null, 2));
        console.log('💾 Saved watch data to file');
    } catch (error) {
        console.error('Failed to save watch data:', error);
    }
}

// Check status with retry logic
async function checkWithRetry(watchData, maxRetries = MAX_RETRIES) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const status = await checkRobloxStatus(watchData.robloxUserId);
            
            // Reset consecutive errors on success
            if (watchData.consecutiveErrors > 0) {
                watchData.consecutiveErrors = 0;
                console.log(`✅ Watch check recovered for ${watchData.username}`);
            }
            
            return status;
        } catch (error) {
            console.error(`⚠️ Watch check attempt ${attempt}/${maxRetries} failed for ${watchData.username}: ${error.message}`);
            
            if (attempt === maxRetries) {
                // Track consecutive errors
                watchData.consecutiveErrors = (watchData.consecutiveErrors || 0) + 1;
                
                // If too many consecutive errors, consider stopping the watch
                if (watchData.consecutiveErrors >= 5) {
                    console.error(`🛑 Watch for ${watchData.username} has failed ${watchData.consecutiveErrors} times consecutively. Consider manual intervention.`);
                }
                
                return null;
            }
            
            // Exponential backoff between retries
            const waitTime = 5000 * attempt;
            console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    return null;
}

// Start watching a user with dynamic intervals
function startWatching(watchData) {
    // Determine initial interval based on last known status
    let currentInterval = watchData.wasOnline ? INTERVAL_ONLINE : INTERVAL_OFFLINE;
    
    async function performCheck() {
        try {
            // Check if watch has expired
            if (new Date() > new Date(watchData.endTime)) {
                console.log(`⏱️ Watch expired for ${watchData.username}`);
                activeWatches.delete(watchData.username);
                await saveWatches();
                return; // Don't schedule next check
            }
            
            // Check user status with retry logic
            const status = await checkWithRetry(watchData);
            
            // Handle check failure
            if (!status) {
                console.error(`❌ All check attempts failed for ${watchData.username}`);
                // Schedule next check with current interval (don't change on error)
                watchData.timeoutId = setTimeout(performCheck, currentInterval);
                return;
            }
            
            // Process status change
            const previouslyOnline = watchData.wasOnline;
            const currentlyOnline = status.online === true;
            
            // User came online - send notifications
            if (currentlyOnline && !previouslyOnline) {
                console.log(`🚨 ${watchData.username} is now ONLINE!`);
                
                // Update watch data
                watchData.wasOnline = true;
                activeWatches.set(watchData.username, watchData);
                await saveWatches();
                
                // Send notifications
                await sendNotifications(watchData, status);
                
                // Switch to frequent checking
                currentInterval = INTERVAL_ONLINE;
                console.log(`⏰ Switched to online interval (${INTERVAL_ONLINE/60000} min) for ${watchData.username}`);
                
            } 
            // User went offline
            else if (!currentlyOnline && previouslyOnline) {
                console.log(`💤 ${watchData.username} went offline`);
                
                // Update watch data
                watchData.wasOnline = false;
                activeWatches.set(watchData.username, watchData);
                await saveWatches();
                
                // Switch to less frequent checking
                currentInterval = INTERVAL_OFFLINE;
                console.log(`⏰ Switched to offline interval (${INTERVAL_OFFLINE/60000} min) for ${watchData.username}`);
            }
            // No status change - log periodically
            else if (Date.now() % 10 === 0) { // Log occasionally to avoid spam
                const statusText = currentlyOnline ? 'online' : 'offline';
                console.log(`👁️ ${watchData.username} is still ${statusText} (next check in ${currentInterval/60000} min)`);
            }
            
        } catch (error) {
            console.error(`❌ Unexpected error in watch for ${watchData.username}:`, error);
            watchData.consecutiveErrors = (watchData.consecutiveErrors || 0) + 1;
        } finally {
            // Always schedule next check (unless watch expired)
            if (activeWatches.has(watchData.username)) {
                watchData.timeoutId = setTimeout(performCheck, currentInterval);
            }
        }
    }
    
    // Start the first check immediately
    console.log(`👁️ Starting watch for ${watchData.username} with ${currentInterval/60000} minute interval`);
    performCheck();
}

// Send DM notifications
async function sendNotifications(watchData, status) {
    try {
        const client = watchData.client;
        if (!client) {
            console.error('❌ No client available for notifications');
            return;
        }
        
        // Only notify the person who started the watch
        const user = await client.users.fetch(watchData.startedById).catch(() => null);
        if (!user) {
            console.error(`❌ Could not find user ${watchData.startedById} to send notification`);
            return;
        }
        
        // Create notification embed
        const embed = new EmbedBuilder()
            .setTitle('🚨 WATCH ALERT: Suspect Online!')
            .setColor(0xFF0000)
            .setDescription(`**${watchData.username}** is now online!`)
            .addFields(
                {
                    name: '📊 Status',
                    value: status.status || 'Online',
                    inline: true
                },
                {
                    name: '🎮 Activity',
                    value: status.game || 'Unknown',
                    inline: true
                }
            )
            .setTimestamp();
        
        // Add join information if available
        if (status.joinUrls?.authenticated) {
            embed.addFields({
                name: '🚀 Direct Join',
                value: `[Click to Join Server](${status.joinUrls.authenticated})`,
                inline: false
            });
        } else if (status.joinUrls?.console) {
            embed.addFields({
                name: '⚠️ Manual Join',
                value: `Console method available:\n\`\`\`${status.joinUrls.console}\`\`\``,
                inline: false
            });
        }
        
        embed.setFooter({ 
            text: `Use /stopwatch to stop monitoring once arrested` 
        });
        
        // Send DM to the watch starter only
        try {
            await user.send({ embeds: [embed] });
            console.log(`📨 Sent watch notification to ${user.tag} for ${watchData.username}`);
        } catch (error) {
            console.log(`Failed to DM ${user.tag}: ${error.message}`);
            
            // Try to notify in the original guild if DM fails
            try {
                const guild = await client.guilds.fetch(watchData.guildId);
                const channel = guild.systemChannel || guild.channels.cache.find(ch => ch.type === 0);
                if (channel) {
                    await channel.send({
                        content: `<@${watchData.startedById}> - Watch alert for **${watchData.username}** (couldn't send DM)`,
                        embeds: [embed]
                    });
                }
            } catch (channelError) {
                console.error('Could not send notification anywhere:', channelError);
            }
        }
        
    } catch (error) {
        console.error('Failed to send notifications:', error);
    }
}

// Stop a watch (exposed for stopwatch command)
function stopWatch(username) {
    const watchData = activeWatches.get(username);
    if (watchData) {
        if (watchData.timeoutId) {
            clearTimeout(watchData.timeoutId);
        }
        activeWatches.delete(username);
        console.log(`🛑 Stopped watch for ${username}`);
        
        // Save updated watches
        saveWatches().catch(error => console.error('Error saving after stop:', error));
        return true;
    }
    return false;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('watch')
        .setDescription('Monitor a user for up to 24 hours')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Roblox username to watch')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('hours')
                .setDescription('Duration in hours (max 24)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(24)
        ),

    async execute(interaction) {
        // Check permissions silently
        if (await checkPermissionSilent(interaction, 'watch')) {
            return; // Silent denial
        }

        const username = interaction.options.getString('username');
        const hours = interaction.options.getInteger('hours');

        // Check maximum watch limit
        if (activeWatches.size >= MAX_CONCURRENT_WATCHES) {
            await interaction.reply({
                content: `⚠️ Maximum watch limit (${MAX_CONCURRENT_WATCHES}) reached. Please stop another watch first using \`/stopwatch\` or check active watches with \`/watchlist\`.`,
                ephemeral: true
            });
            return;
        }

        // Check if already watching this user
        if (activeWatches.has(username)) {
            const existingWatch = activeWatches.get(username);
            const endTime = new Date(existingWatch.endTime);
            const remainingHours = Math.ceil((endTime - new Date()) / (1000 * 60 * 60));
            
            await interaction.reply({
                content: `⚠️ Already watching **${username}**.\nRemaining time: ${remainingHours} hour(s)\nStarted by: ${existingWatch.startedBy}`,
                ephemeral: true
            });
            return;
        }

        // Defer reply for processing
        await interaction.deferReply({ ephemeral: true });

        try {
            // Get Roblox user ID
            const robloxUserResult = await getRobloxUserId(username);
            
            if (!robloxUserResult || (typeof robloxUserResult === 'object' && robloxUserResult.error)) {
                // Handle rate limit
                if (robloxUserResult?.error === 'rate_limited') {
                    await interaction.editReply({
                        content: `⏳ Roblox API is rate limited. Please try again in ${robloxUserResult.retryAfter} seconds.`,
                    });
                    return;
                }
                
                await interaction.editReply({
                    content: `❌ Could not find user **${username}** on Roblox.`,
                });
                return;
            }

            const robloxUserId = robloxUserResult;

            // Check initial status
            const initialStatus = await checkRobloxStatus(robloxUserId);
            
            // Create watch data
            const watchData = {
                username: username,
                robloxUserId: robloxUserId,
                startedBy: interaction.user.tag,
                startedById: interaction.user.id,
                guildId: interaction.guild.id,
                startTime: new Date().toISOString(),
                endTime: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
                wasOnline: initialStatus?.online === true,
                consecutiveErrors: 0,
                client: interaction.client
            };
            
            // Start watching
            activeWatches.set(username, watchData);
            startWatching(watchData);
            await saveWatches();
            
            // Determine initial interval for display
            const initialInterval = watchData.wasOnline ? 
                `${INTERVAL_ONLINE/60000} minute` : 
                `${INTERVAL_OFFLINE/60000} minute`;
            
            // Create response embed
            const embed = new EmbedBuilder()
                .setTitle('👁️ Watch Started')
                .setColor(0x00FF00)
                .setDescription(`Now monitoring **${username}** for ${hours} hour(s)`)
                .addFields(
                    {
                        name: '📊 Current Status',
                        value: initialStatus?.status || 'Unknown',
                        inline: true
                    },
                    {
                        name: '⏰ Duration',
                        value: `${hours} hour(s)`,
                        inline: true
                    },
                    {
                        name: '🔄 Check Interval',
                        value: `${initialInterval}s (dynamic)`,
                        inline: true
                    },
                    {
                        name: '🔔 Notifications',
                        value: 'You will be notified via DM when user comes online',
                        inline: false
                    },
                    {
                        name: '📋 Smart Monitoring',
                        value: '• Checks every minute when online\n• Checks every 10 minutes when offline\n• Automatic retry on failures',
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `Watch ends at ${new Date(watchData.endTime).toLocaleString()}` 
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            
            console.log(`👁️ Started watching ${username} for ${hours} hours by ${interaction.user.tag}`);
            
        } catch (error) {
            console.error('Watch command error:', error);
            await interaction.editReply({
                content: '❌ Failed to start watch. Please try again.',
            });
        }
    },

    // Initialize watches on bot startup
    async initialize(client) {
        // Load existing watches
        await loadWatches();
        
        // Update client reference and restart watching
        for (const watch of activeWatches.values()) {
            watch.client = client;
            startWatching(watch);
        }
        
        console.log(`👁️ Watch system initialized with ${activeWatches.size} active watches`);
    },
    
    // Cleanup function for graceful shutdown
    cleanup() {
        console.log('🔄 Cleaning up watches...');
        for (const watchData of activeWatches.values()) {
            if (watchData.timeoutId) {
                clearTimeout(watchData.timeoutId);
            }
        }
        console.log('✅ Watch cleanup complete');
    },
    
    // Export for stopwatch command
    stopWatch,
    getActiveWatches: () => activeWatches,
    MAX_CONCURRENT_WATCHES
};