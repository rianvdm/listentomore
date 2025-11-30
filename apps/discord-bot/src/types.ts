// Discord interaction types

export interface DiscordInteraction {
  type: number;
  id: string;
  token: string;
  channel_id: string;
  member: {
    user: {
      username: string;
      id: string;
    };
    nick?: string;
  };
  data: {
    name: string;
    options?: Array<{
      name: string;
      value: string;
    }>;
  };
}

// Discord Interaction Types
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

// Get option value from interaction
export function getOption(interaction: DiscordInteraction, name: string): string | undefined {
  return interaction.data.options?.find((opt) => opt.name === name)?.value;
}

// Get the display name of the user who invoked the command
export function getUsername(interaction: DiscordInteraction): string {
  return interaction.member.nick || interaction.member.user.username;
}
