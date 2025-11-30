// Discord API helper functions

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export interface MessageContent {
  content?: string;
  embeds?: DiscordEmbed[];
  flags?: number;
}

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  thumbnail?: { url: string };
  footer?: { text: string };
  color?: number;
}

// Discord Interaction Response Types
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

// Message flags
export const MessageFlags = {
  EPHEMERAL: 64, // Only visible to the user who invoked the command
} as const;

/**
 * Send a new message to a Discord channel
 */
export async function sendNewMessage(
  botToken: string,
  channelId: string,
  messageContent: MessageContent
): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messageContent),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Failed to send new message: ${response.statusText}. Response: ${errorBody}`);
  }
}

/**
 * Send a follow-up message to a Discord interaction
 */
export async function sendFollowUpMessage(
  applicationId: string,
  interactionToken: string,
  messageContent: MessageContent
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageContent),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Failed to send follow-up message: ${response.statusText}. Response: ${errorBody}`);
  }
}

/**
 * Create an ephemeral response (only visible to the command user)
 * Use this as the immediate response to a slash command
 */
export function createEphemeralResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: message,
        flags: MessageFlags.EPHEMERAL,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Create a public response (visible to everyone)
 * Use this as the immediate response to a slash command
 */
export function createPublicResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: message,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Create a PONG response for Discord's ping verification
 */
export function createPongResponse(): Response {
  return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Delete the initial interaction response (the "thinking" message)
 */
export async function deleteInitialResponse(
  applicationId: string,
  interactionToken: string
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    console.error(`Failed to delete initial response: ${response.statusText}`);
  }
}
