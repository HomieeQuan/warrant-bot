const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRobloxUserId, checkRobloxStatus } = require('../utils/roblox-api');
const { checkPermissionSilent } = require('../utils/permissions');

// Helper function to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bulk-check')
        .setDescription('Check multiple suspects at once (max 5)')
        .addStringOption(option =>
            option.setName('user1')
                .setDescription('First Roblox username')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('user2')
                .setDescription('Second Roblox username')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('user3')
                .setDescription('Third Roblox username')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('user4')
                .setDescription('Fourth Roblox username')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('user5')
                .setDescription('Fifth Roblox username')
                .setRequired(false)
        ),

    async execute(interaction) {
        // Check permissions silently
        if (await checkPermissionSilent(interaction, 'bulk-check')) {
            return; // Silent denial
        }

        // Collect all usernames
        const usernames = [];
        for (let i = 1; i <= 5; i++) {
            const username = interaction.options.getString(`user${i}`);
            if (username) {
                usernames.push(username);
            }
        }

        // Defer reply for processing
        await interaction.deferReply();

        // Process results
        const results = [];
        const embed = new EmbedBuilder()
            .setTitle(`🔍 Bulk Investigation Report`)
            .setColor(0x0099FF)
            .setDescription(`Checking ${usernames.length} suspect(s)...`)
            .setTimestamp();

        // Send initial message
        await interaction.editReply({ embeds: [embed] });

        // Check each user sequentially with delay
        for (let i = 0; i < usernames.length; i++) {
            const username = usernames[i];
            
            // Add delay between checks (except for first one)
            if (i > 0) {
                await sleep(2000); // 2 second delay
            }

            try {
                // Get Roblox user ID
                const robloxUserResult = await getRobloxUserId(username);
                
                // Handle errors
                if (!robloxUserResult || (typeof robloxUserResult === 'object' && robloxUserResult.error)) {
                    results.push({
                        username: username,
                        status: '❌ User Not Found',
                        color: 0xFF0000,
                        details: 'Could not find this user on Roblox',
                        joinAvailable: false
                    });
                    continue;
                }

                const robloxUserId = robloxUserResult;

                // Check user status
                const status = await checkRobloxStatus(robloxUserId);
                
                // Determine status emoji and color
                let statusEmoji, statusColor, joinInfo = '';
                
                if (status.online === true) {
                    statusEmoji = '🟢';
                    statusColor = 0x00FF00;
                    
                    // Check join availability
                    if (status.joinUrls?.authenticated) {
                        joinInfo = `\n└ **[Direct Join Available](${status.joinUrls.authenticated})**`;
                    } else if (status.joinUrls?.console) {
                        joinInfo = '\n└ ⚠️ Manual join available (console method)';
                    } else if (status.game && status.game !== 'Not in game') {
                        joinInfo = '\n└ ❌ Cannot join (hidden details)';
                    }
                } else if (status.online === false) {
                    statusEmoji = '⚫';
                    statusColor = 0x808080;
                } else {
                    statusEmoji = '🟡';
                    statusColor = 0xFFAA00;
                }

                results.push({
                    username: username,
                    userId: robloxUserId,
                    status: `${statusEmoji} ${status.status}`,
                    game: status.game,
                    color: statusColor,
                    details: status.game || 'Not in game',
                    joinInfo: joinInfo
                });

            } catch (error) {
                console.error(`Error checking ${username}:`, error);
                results.push({
                    username: username,
                    status: '⚠️ Check Failed',
                    color: 0xFFAA00,
                    details: 'API error occurred',
                    joinAvailable: false
                });
            }

            // Update embed with progress
            const progressEmbed = new EmbedBuilder()
                .setTitle(`🔍 Bulk Investigation Report`)
                .setColor(0x0099FF)
                .setDescription(`Progress: ${i + 1}/${usernames.length} checked`)
                .setTimestamp();

            // Add results so far
            results.forEach((result, index) => {
                let fieldValue = `Status: ${result.status}`;
                if (result.userId) {
                    fieldValue += `\nID: \`${result.userId}\``;
                }
                if (result.game) {
                    fieldValue += `\nActivity: ${result.game}`;
                }
                if (result.joinInfo) {
                    fieldValue += result.joinInfo;
                }

                progressEmbed.addFields({
                    name: `${index + 1}. ${result.username}`,
                    value: fieldValue,
                    inline: false
                });
            });

            await interaction.editReply({ embeds: [progressEmbed] });
        }

        // Create final summary embed
        const finalEmbed = new EmbedBuilder()
            .setTitle(`🔍 Bulk Investigation Complete`)
            .setColor(0x00FF00)
            .setDescription(`Checked ${usernames.length} suspect(s)`)
            .setTimestamp();

        // Count statistics
        let onlineCount = 0;
        let offlineCount = 0;
        let unknownCount = 0;

        results.forEach((result, index) => {
            if (result.status.includes('🟢')) onlineCount++;
            else if (result.status.includes('⚫')) offlineCount++;
            else unknownCount++;

            let fieldValue = `Status: ${result.status}`;
            if (result.userId) {
                fieldValue += `\nID: \`${result.userId}\``;
            }
            if (result.game) {
                fieldValue += `\nActivity: ${result.game}`;
            }
            if (result.joinInfo) {
                fieldValue += result.joinInfo;
            }

            finalEmbed.addFields({
                name: `${index + 1}. ${result.username}`,
                value: fieldValue,
                inline: false
            });
        });

        // Add summary
        finalEmbed.addFields({
            name: '📊 Summary',
            value: `🟢 Online: ${onlineCount}\n⚫ Offline: ${offlineCount}\n🟡 Other: ${unknownCount}`,
            inline: false
        });

        finalEmbed.setFooter({ 
            text: `Bulk check completed by ${interaction.user.tag}` 
        });

        await interaction.editReply({ embeds: [finalEmbed] });

        // Log the bulk check
        console.log(`✅ Bulk check completed for ${usernames.join(', ')} by ${interaction.user.tag}`);
    },
};