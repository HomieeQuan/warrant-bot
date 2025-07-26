const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRobloxUserId, checkRobloxStatus, checkRateLimit, getRemainingCooldown } = require('../utils/roblox-api');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check')
        .setDescription('Check if a suspect is online and get join link for arrest')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Roblox username to investigate')
                .setRequired(true)
        ),

    async execute(interaction) {
        const username = interaction.options.getString('username');
        const userId = interaction.user.id;

        // Check rate limit
        if (!checkRateLimit(userId)) {
            const remaining = Math.ceil(getRemainingCooldown(userId) / 1000);
            await interaction.reply({
                content: `⏰ Agent cooldown: ${remaining} seconds remaining`,
                ephemeral: true
            });
            return;
        }

        // Defer reply since API calls might take time
        await interaction.deferReply();

        try {
            // Get Roblox user ID
            const robloxUserId = await getRobloxUserId(username);
            
            if (!robloxUserId) {
                await interaction.editReply(`❌ Target "${username}" not found on Roblox`);
                return;
            }

            // Check user status
            const status = await checkRobloxStatus(robloxUserId);
            
            // Determine embed color and status emoji
            let embedColor, statusEmoji;
            
            if (status.error) {
                embedColor = 0x808080; // Gray for errors
                statusEmoji = '❓';
            } else if (status.online === true) {
                embedColor = 0x00FF00; // Green for online
                statusEmoji = '🟢';
            } else if (status.online === false) {
                embedColor = 0xFF0000; // Red for offline
                statusEmoji = '🔴';
            } else {
                embedColor = 0xFFFF00; // Yellow for private/unknown
                statusEmoji = '🟡';
            }
            
            // Create clean FBI-focused embed
            const embed = new EmbedBuilder()
                .setTitle('🕵️ Surveillance Report')
                .setColor(embedColor)
                .addFields(
                    { 
                        name: '👤 Target', 
                        value: `\`${username}\``, 
                        inline: true 
                    },
                    { 
                        name: '📡 Status', 
                        value: `${statusEmoji} **${status.status}**`, 
                        inline: true 
                    }
                );

            // Add game info if user is playing something
            if (status.game) {
                embed.addFields({
                    name: '🎮 Current Activity',
                    value: `${status.game}`,
                    inline: false
                });
            }

            // Add join link for agents if available
            if (status.joinUrl) {
                embed.addFields({
                    name: '🚨 Agent Operations',
                    value: `[📍 Join for Arrest](${status.joinUrl})`,
                    inline: false
                });
            }

            // Add footer with basic info
            embed.setFooter({ 
                text: `Surveillance • User ID: ${robloxUserId}` 
            })
            .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('FBI surveillance error:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Surveillance Failed')
                .setColor(0xFF0000)
                .addFields(
                    {
                        name: '👤 Target',
                        value: `\`${username}\``,
                        inline: false
                    },
                    {
                        name: '❗ Error',
                        value: 'Surveillance systems temporarily offline. Try again in a few minutes.',
                        inline: false
                    }
                )
                .setFooter({ text: 'FBI Warrant Bot' });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};