const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check bot status and Roblox API health'),

    async execute(interaction) {
        await interaction.deferReply();

        // Calculate uptime
        const uptimeSeconds = Math.floor(process.uptime());
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;
        const uptimeString = `${hours}h ${minutes}m ${seconds}s`;

        // Test Roblox API health
        let apiHealth = '🟡 Testing...';
        let apiDetails = 'Checking API endpoints...';

        try {
            const startTime = Date.now();
            
            // Test basic API endpoint
            const testResponse = await axios.get('https://api.roblox.com/users/1', { timeout: 5000 });
            const responseTime = Date.now() - startTime;
            
            if (testResponse.status === 200) {
                apiHealth = '🟢 Healthy';
                apiDetails = `Response time: ${responseTime}ms`;
            } else {
                apiHealth = '🟠 Degraded';
                apiDetails = `Unexpected status: ${testResponse.status}`;
            }
        } catch (error) {
            apiHealth = '🔴 Unhealthy';
            apiDetails = `Error: ${error.message}`;
        }

        const embed = new EmbedBuilder()
            .setTitle('🤖 Bot Status Report')
            .setColor(0x0099FF)
            .addFields(
                {
                    name: '🔘 Bot Status',
                    value: '🟢 **Online & Ready**',
                    inline: true
                },
                {
                    name: '⏱️ Uptime',
                    value: `\`${uptimeString}\``,
                    inline: true
                },
                {
                    name: '🔗 Roblox API',
                    value: apiHealth,
                    inline: true
                },
                {
                    name: '📊 API Details',
                    value: apiDetails,
                    inline: false
                },
                {
                    name: '💾 Memory Usage',
                    value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
                    inline: true
                },
                {
                    name: '📍 Server Location',
                    value: 'Unknown',
                    inline: true
                }
            )
            .setFooter({ 
                text: `Roblox Status Bot v1.0 | Node.js ${process.version}` 
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};