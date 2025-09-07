const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRobloxUserId, checkRobloxStatus, checkRateLimit, getRemainingCooldown } = require('../utils/roblox-api');
const { checkPermissionSilent } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check')
        .setDescription('Check if a suspect is online and get join link')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Roblox username to investigate')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Check permissions silently
        if (await checkPermissionSilent(interaction, 'check')) {
            return; // Silent denial
        }

        const username = interaction.options.getString('username');
        const userId = interaction.user.id;

        // Check rate limit
        if (!checkRateLimit(userId)) {
            const remaining = Math.ceil(getRemainingCooldown(userId) / 1000);
            await interaction.reply({
                content: `⏰ Cooldown: ${remaining} seconds remaining`,
                ephemeral: true
            });
            return;
        }

        // Defer reply for API calls
        await interaction.deferReply();

        try {
            // Get Roblox user ID
            const robloxUserResult = await getRobloxUserId(username);
            
            // Handle rate limit error (when API returns error object)
            if (robloxUserResult && typeof robloxUserResult === 'object' && robloxUserResult.error === 'rate_limited') {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('⏳ Roblox API Busy')
                    .setColor(0xFFAA00)
                    .setDescription(`Roblox is currently limiting requests. Please try again in ${robloxUserResult.retryAfter || 5} seconds.`)
                    .addFields({
                        name: 'Tip',
                        value: 'This happens when many people use the bot at once.',
                        inline: false
                    })
                    .setTimestamp();

                await interaction.editReply({ embeds: [errorEmbed] });
                return;
            }
            
            // Handle user not found (null or invalid result)
            if (!robloxUserResult || (typeof robloxUserResult === 'object' && robloxUserResult.error)) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ User Not Found')
                    .setColor(0xFF0000)
                    .setDescription(`Could not find user "${username}" on Roblox`)
                    .addFields({
                        name: 'Check',
                        value: '• Spelling is correct\n• User exists on Roblox\n• Account is not terminated',
                        inline: false
                    })
                    .setTimestamp();

                await interaction.editReply({ embeds: [errorEmbed] });
                return;
            }

            // At this point robloxUserResult should be a valid user ID
            const robloxUserId = robloxUserResult;

            // Check user status
            const status = await checkRobloxStatus(robloxUserId);
            
            // Handle API errors
            if (status.error && status.status === 'API Error') {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Connection Error')
                    .setColor(0xFFAA00)
                    .setDescription(`Could not check status for \`${username}\``)
                    .addFields({
                        name: 'Issue',
                        value: 'Roblox API is not responding properly. Please try again.',
                        inline: false
                    })
                    .setTimestamp();

                await interaction.editReply({ embeds: [errorEmbed] });
                return;
            }

            // Determine embed color based on status
            let embedColor;
            if (status.online === true) {
                embedColor = 0x00FF00; // Green for online
            } else if (status.online === false) {
                embedColor = 0x808080; // Gray for offline
            } else {
                embedColor = 0xFFAA00; // Orange for unknown/private
            }

            // Build the status embed
            const embed = new EmbedBuilder()
                .setTitle(`🔍 Investigation Report: ${username}`)
                .setColor(embedColor)
                .setDescription(`User ID: \`${robloxUserId}\``)
                .addFields({
                    name: '📊 Status',
                    value: status.status || 'Unknown',
                    inline: true
                });

            // Add game info if available
            if (status.game) {
                embed.addFields({
                    name: '🎮 Current Activity',
                    value: status.game,
                    inline: true
                });
            }

            // Add join options based on availability
            if (status.joinUrls && status.joinUrls.authenticated) {
                // Best case: Direct join available
                let joinValue = `✅ **[Click to Join Server](${status.joinUrls.authenticated})**\n`;
                joinValue += `*Direct join to their exact server*`;
                
                embed.addFields({
                    name: '🚀 Join Server',
                    value: joinValue,
                    inline: false
                });
                
            } else if (status.joinsDisabled && status.joinUrls?.console) {
                // Joins disabled but we can bypass with console
                let joinValue = `**User has joins disabled, but you can still join using the console method:**\n\n`;
                joinValue += `**Step 1:** Copy this script:\n`;
                joinValue += `\`\`\`javascript\n${status.joinUrls.console}\n\`\`\`\n`;
                joinValue += `**Step 2:** Open **[Roblox.com](https://www.roblox.com)** in your browser\n`;
                joinValue += `**Step 3:** Press \`F12\` to open the developer console\n`;
                joinValue += `**Step 4:** Paste the script and press \`Enter\`\n\n`;
                joinValue += `*Note: If you get Error 524, they're in a private server*`;
                
                embed.addFields({
                    name: '🚫 Joins Disabled - Manual Join Available',
                    value: joinValue,
                    inline: false
                });
                
            } else if (status.joinUrls?.console && !status.hasAuthentication) {
                // No auth cookie but console available
                let joinValue = `**Manual join required (no authentication):**\n\n`;
                joinValue += `\`\`\`javascript\n${status.joinUrls.console}\n\`\`\`\n`;
                joinValue += `Open **[Roblox.com](https://www.roblox.com)** → Press \`F12\` → Paste in console`;
                
                embed.addFields({
                    name: '⚠️ Manual Join Required',
                    value: joinValue,
                    inline: false
                });
                
            } else if (status.online && status.game && status.game !== 'Not in game' && status.game !== 'Roblox Studio') {
                // In game but no join method available
                embed.addFields({
                    name: '❌ Cannot Join',
                    value: 'Unable to generate join link.\nGame details are hidden.',
                    inline: false
                });
            }

            // Add footer based on status
            if (status.hasAuthentication && status.joinUrls?.authenticated) {
                embed.setFooter({ 
                    text: '✅ Direct Join Available' 
                });
            } else if (status.joinsDisabled) {
                embed.setFooter({ 
                    text: '🔧 Console Method Available - Joins Disabled Bypass' 
                });
            } else if (status.joinUrls?.console) {
                embed.setFooter({ 
                    text: '⚠️ Manual Join Required' 
                });
            } else if (status.online && status.game && status.game !== 'Not in game') {
                embed.setFooter({ 
                    text: '❌ Join Not Available' 
                });
            }

            // Add timestamp
            embed.setTimestamp();

            // Send the response
            await interaction.editReply({ embeds: [embed] });
            
            // Log the check
            console.log(`✅ Check completed for ${username} by ${interaction.user.tag}`);

        } catch (error) {
            console.error('Check command error:', error);
            
            // Ensure we always respond to avoid infinite loading
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Check Failed')
                .setColor(0xFF0000)
                .setDescription(`Could not check status for \`${username}\``)
                .addFields({
                    name: 'Error',
                    value: 'An unexpected error occurred. Please try again.',
                    inline: false
                })
                .setTimestamp();

            try {
                await interaction.editReply({ embeds: [errorEmbed] });
            } catch (replyError) {
                console.error('Failed to send error message:', replyError);
            }
        }
    },
};