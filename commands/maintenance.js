const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getCookieStatus, checkCookieHealth } = require('../utils/roblox-api');
const { checkPermissionSilent } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('maintenance')
        .setDescription('Check authentication system health'),

    async execute(interaction) {
        // Check permissions silently
        if (await checkPermissionSilent(interaction, 'maintenance')) {
            return; // Silent denial
        }

        await interaction.deferReply({ ephemeral: true });

        // Get current cookie status
        const status = getCookieStatus();
        
        // Test cookie health in real-time
        console.log('🔍 Testing cookie health...');
        const isHealthy = await checkCookieHealth();
        
        // Determine status color and emoji
        let color, statusEmoji, statusText;
        
        if (!process.env.ROBLOSECURITY_COOKIE) {
            color = 0xFF0000; // Red
            statusEmoji = '❌';
            statusText = 'NOT CONFIGURED';
        } else if (status.status === 'expired') {
            color = 0xFF0000; // Red
            statusEmoji = '🔴';
            statusText = 'EXPIRED - NEEDS RENEWAL';
        } else if (status.needsMaintenance) {
            color = 0xFFAA00; // Orange
            statusEmoji = '⚠️';
            statusText = 'DEGRADED - CHECK NEEDED';
        } else if (isHealthy) {
            color = 0x00FF00; // Green
            statusEmoji = '✅';
            statusText = 'HEALTHY';
        } else {
            color = 0xFFFF00; // Yellow
            statusEmoji = '🟡';
            statusText = 'UNKNOWN';
        }

        const embed = new EmbedBuilder()
            .setTitle('🔧 System Maintenance Report')
            .setColor(color)
            .addFields(
                {
                    name: '🔐 Authentication Status',
                    value: `${statusEmoji} **${statusText}**`,
                    inline: false
                }
            );

        // Add detailed info if cookie exists
        if (process.env.ROBLOSECURITY_COOKIE) {
            const cookieLength = process.env.ROBLOSECURITY_COOKIE.length;
            
            embed.addFields(
                {
                    name: '📊 Cookie Info',
                    value: `Length: ${cookieLength} characters\nFailures: ${status.failureCount}`,
                    inline: true
                }
            );

            if (status.lastSuccess) {
                embed.addFields(
                    {
                        name: '🕐 Last Success',
                        value: `${status.hoursSinceSuccess}h ago\n${status.lastSuccess.toLocaleString()}`,
                        inline: true
                    }
                );
            }
        }

        // Add system info
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);

        embed.addFields(
            {
                name: '⏱️ System Uptime',
                value: `${hours}h ${minutes}m`,
                inline: true
            },
            {
                name: '💾 Memory Usage',
                value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
                inline: true
            }
        );

        // Add maintenance instructions if needed
        if (status.needsMaintenance || !isHealthy) {
            embed.addFields(
                {
                    name: '🛠️ Maintenance Required',
                    value: '1. Log into alt Roblox account\n2. Get new .ROBLOSECURITY cookie\n3. Update .env file\n4. Restart bot',
                    inline: false
                }
            );
        }

        // Add footer
        embed.setFooter({ 
            text: `Bot Health Check • ${new Date().toLocaleString()}` 
        });

        await interaction.editReply({ embeds: [embed] });

        // Log maintenance check
        console.log(`🔧 Maintenance check by ${interaction.user.tag}`);
    },
};