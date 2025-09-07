const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];

// Load all command files
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    // Skip status.js as it's being removed
    if (file === 'status.js') {
        console.log(`⏩ Skipping removed command: status`);
        // Delete the file if it exists
        const statusPath = path.join(commandsPath, 'status.js');
        if (fs.existsSync(statusPath)) {
            fs.unlinkSync(statusPath);
            console.log(`🗑️ Deleted status.js file`);
        }
        continue;
    }
    
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
        console.log(`✅ Loaded command: ${command.data.name}`);
    } else {
        console.log(`⚠️ Command ${file} is missing required "data" or "execute" property.`);
    }
}

// Create REST instance
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Deploy commands
(async () => {
    try {
        console.log(`🔄 Started refreshing ${commands.length} application (/) commands.`);

        // Register commands to a specific guild (faster for testing)
        // Remove guild-specific registration for global commands (takes up to 1 hour)
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );

        console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
        console.log('Commands registered to guild:', process.env.GUILD_ID);
        console.log('Available commands:', commands.map(c => c.name).join(', '));
        
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
})();