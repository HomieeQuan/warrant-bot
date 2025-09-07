const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermissionSilent } = require('../utils/permissions');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Watch data file path - same as in watch.js
const WATCH_DATA_FILE = path.join(os.tmpdir(), 'warrant-bot-watches.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stopwatch')
        .setDescription('Stop monitoring a user')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Roblox username to stop watching')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Check permissions silently
        if (await checkPermissionSilent(interaction, 'watch')) {
            return; // Silent denial - same permissions as watch command
        }

        const username = interaction.options.getString('username');
        
        // Get watch command to access active watches and stop function
        const watchCommand = interaction.client.commands.get('watch');
        if (!watchCommand) {
            await interaction.reply({
                content: '❌ Watch system not available.',
                ephemeral: true
            });
            return;
        }

        // Get active watches from the watch command
        const activeWatches = watchCommand.getActiveWatches();
        const watchData = Array.from(activeWatches.values()).find(
            w => w.username.toLowerCase() === username.toLowerCase()
        );
        
        if (!watchData) {
            await interaction.reply({
                content: `❌ **${username}** is not currently being watched.`,
                ephemeral: true
            });
            return;
        }

        // Check if the user has permission to stop this watch
        // Allow: the person who started it, or anyone with . role
        const canStop = watchData.startedById === interaction.user.id || 
                       interaction.member.roles.cache.some(role => role.name === '.');
        
        if (!canStop) {
            await interaction.reply({
                content: `⚠️ Only **${watchData.startedBy}** or administrators can stop this watch.`,
                ephemeral: true
            });
            return;
        }

        // Stop the watch using the watch command's stopWatch function
        const stopped = watchCommand.stopWatch(username);
        
        if (stopped) {
            // Calculate how long the watch was active
            const startTime = new Date(watchData.startTime);
            const duration = Date.now() - startTime.getTime();
            const hours = Math.floor(duration / (1000 * 60 * 60));
            const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
            
            // Create confirmation embed
            const embed = new EmbedBuilder()
                .setTitle('🛑 Watch Stopped')
                .setColor(0xFF0000)
                .setDescription(`Stopped monitoring **${username}**`)
                .addFields(
                    {
                        name: '📊 Watch Info',
                        value: `Started by: ${watchData.startedBy}\nDuration: ${hours}h ${minutes}m`,
                        inline: true
                    },
                    {
                        name: '✅ Status',
                        value: 'Watch successfully terminated',
                        inline: true
                    }
                )
                .setFooter({ 
                    text: `Stopped by ${interaction.user.tag}` 
                })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            
            console.log(`🛑 Watch stopped for ${username} by ${interaction.user.tag}`);
        } else {
            await interaction.reply({
                content: `❌ Failed to stop watch for **${username}**. Please try again.`,
                ephemeral: true
            });
        }
    },
};