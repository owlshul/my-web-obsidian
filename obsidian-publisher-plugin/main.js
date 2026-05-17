const { Plugin, PluginSettingTab, Setting, Notice, requestUrl } = require('obsidian');

const DEFAULT_SETTINGS = {
    serverUrl: 'https://padhlebhaii.vercel.app',
    apiKey: 'admin123_sync_key',
    defaultVisibility: 'public'
}

module.exports = class WebPublisher extends Plugin {
    async onload() {
        await this.loadSettings();

        // Add a button to the left ribbon.
        this.addRibbonIcon('paper-plane', 'Publish Current Note to Web', async () => {
            await this.publishCurrentNote();
        });

        // Add a command to the command palette.
        this.addCommand({
            id: 'publish-current-note',
            name: 'Publish Current Note to Web',
            callback: () => {
                this.publishCurrentNote();
            }
        });

        // Add settings tab
        this.addSettingTab(new WebPublisherSettingTab(this.app, this));
    }

    async publishCurrentNote() {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice('No active note to publish!');
            return;
        }

        if (file.extension !== 'md') {
            new Notice('Only Markdown (.md) files can be published.');
            return;
        }

        new Notice(`Publishing ${file.basename}...`);
        
        try {
            const content = await this.app.vault.read(file);
            const serverUrl = this.settings.serverUrl.replace(/\/$/, ''); // Remove trailing slash if any
            
            const res = await requestUrl({
                url: `${serverUrl}/api/sync`,
                method: 'POST',
                throw: false,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    path: file.path,
                    title: file.basename,
                    content: content,
                    visibility: this.settings.defaultVisibility
                })
            });

            if (res.status === 200) {
                new Notice('✅ Successfully published to web!');
            } else {
                new Notice(`❌ Failed: ${res.json?.error || 'Unknown error'}`);
            }
        } catch (e) {
            new Notice(`❌ Error: ${e.message}`);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class WebPublisherSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const {containerEl} = this;
        containerEl.empty();
        containerEl.createEl('h2', {text: 'Web Publisher Settings'});

        new Setting(containerEl)
            .setName('Server URL')
            .setDesc('Your Vercel deployment URL (e.g., https://padhlebhaii.vercel.app)')
            .addText(text => text
                .setPlaceholder('https://padhlebhaii.vercel.app')
                .setValue(this.plugin.settings.serverUrl)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('The secret API Key configured in your web server (.env)')
            .addText(text => text
                .setPlaceholder('Enter your API Key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));
                
        new Setting(containerEl)
            .setName('Default Visibility')
            .setDesc('Should uploaded notes be public or private by default?')
            .addDropdown(drop => drop
                .addOption('public', 'Public')
                .addOption('private', 'Private')
                .setValue(this.plugin.settings.defaultVisibility)
                .onChange(async (value) => {
                    this.plugin.settings.defaultVisibility = value;
                    await this.plugin.saveSettings();
                }));
    }
}
