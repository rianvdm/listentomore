// Discord slash command registration
// Call /register-commands endpoint to register all commands with Discord

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Discord command option types
const OptionType = {
  STRING: 3,
} as const;

interface CommandOption {
  name: string;
  description: string;
  type: number;
  required: boolean;
}

interface SlashCommand {
  name: string;
  description: string;
  type: 1; // Slash command
  options?: CommandOption[];
}

const commands: SlashCommand[] = [
  {
    name: 'listento',
    description: 'Get details about an album by artist',
    type: 1,
    options: [
      {
        name: 'album',
        description: 'The name of the album',
        type: OptionType.STRING,
        required: true,
      },
      {
        name: 'artist',
        description: 'The name of the artist',
        type: OptionType.STRING,
        required: true,
      },
    ],
  },
  {
    name: 'listenlast',
    description: 'Get the most recent album played by a Last.fm user',
    type: 1,
    options: [
      {
        name: 'lastfm_user',
        description: 'The Last.fm username',
        type: OptionType.STRING,
        required: true,
      },
    ],
  },
  {
    name: 'listenurl',
    description: 'Get streaming links for a given URL',
    type: 1,
    options: [
      {
        name: 'url',
        description: 'The URL to fetch streaming links for',
        type: OptionType.STRING,
        required: true,
      },
    ],
  },
  {
    name: 'whois',
    description: 'Get information about an artist',
    type: 1,
    options: [
      {
        name: 'artist',
        description: 'The name of the artist',
        type: OptionType.STRING,
        required: true,
      },
    ],
  },
  {
    name: 'whatis',
    description: 'Get information about a music genre',
    type: 1,
    options: [
      {
        name: 'genre',
        description: 'The genre you want to know more about',
        type: OptionType.STRING,
        required: true,
      },
    ],
  },
  {
    name: 'ask',
    description: 'Ask a question to the AI',
    type: 1,
    options: [
      {
        name: 'question',
        description: 'Your question or prompt for the AI',
        type: OptionType.STRING,
        required: true,
      },
    ],
  },
];

/**
 * Register all slash commands with Discord
 * This only needs to be called once, or when commands change
 */
export async function registerCommands(
  applicationId: string,
  botToken: string
): Promise<void> {
  const url = `${DISCORD_API_BASE}/applications/${applicationId}/commands`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to register commands: ${response.statusText}. Response: ${error}`);
  }

  console.log('Commands registered successfully');
}
