import {
  Client,
  GatewayIntentBits,
  TextChannel,
  EmbedBuilder,
  REST,
  Routes,
  ApplicationCommandOptionType,
} from "discord.js";
import { config } from "dotenv";
import { setInterval, clearInterval } from "timers";

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

let checkInterval = 1000; // Domyślny interwał sprawdzania co 30 sekund
let intervalID: NodeJS.Timeout;
const excludedUsers: Set<string> = new Set(); // Przechowywanie wykluczonych użytkowników

interface UserSpotifyStatus {
  song: string;
  artist: string;
}

const previousStatuses: Map<string, UserSpotifyStatus> = new Map();

client.once("ready", async () => {
  if (!client.user) {
    console.error("Client user is null");
    return;
  }

  console.log(`Zalogowano jako ${client.user.tag}!`);

  // Rejestracja komendy /settings
  const rest = new REST({ version: "10" }).setToken(
    process.env.DISCORD_TOKEN as string
  );
  const commands = [
    {
      name: "settings",
      description: "Dostosuj ustawienia bota",
      options: [
        {
          name: "interval",
          type: ApplicationCommandOptionType.Integer,
          description: "Interwał sprawdzania (w milisekundach)",
          required: false,
          autocomplete: true,
        },
        {
          name: "user-add",
          type: ApplicationCommandOptionType.User,
          description: "Dodaj użytkownika do listy wykluczonych",
          required: false,
        },
        {
          name: "user-remove",
          type: ApplicationCommandOptionType.User,
          description: "Usuń użytkownika z listy wykluczonych",
          required: false,
        },
      ],
    },
  ];

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        process.env.GUILD_ID as string
      ),
      { body: commands }
    );
    console.log("Pomyślnie zarejestrowano komendy slash");
  } catch (error) {
    console.error("Nie udało się zarejestrować komend slash", error);
  }

  fetchSpotifyActivities();
  // @ts-ignore
  intervalID = setInterval(fetchSpotifyActivities, checkInterval);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === "settings") {
    const newInterval = options.get("interval")?.value as number;
    const userAdd = options.get("user-add")?.user;
    const userRemove = options.get("user-remove")?.user;

    if (newInterval && newInterval > 0) {
      checkInterval = newInterval;
      clearInterval(intervalID);
      // @ts-ignore
      intervalID = setInterval(fetchSpotifyActivities, checkInterval);
      await interaction.reply(
        `Interwał sprawdzania został ustawiony na ${newInterval} milisekund.`
      );
    } else if (userAdd) {
      excludedUsers.add(userAdd.id);
      await interaction.reply(
        `Użytkownik ${userAdd.username} został dodany do listy wykluczonych.`
      );
    } else if (userRemove) {
      excludedUsers.delete(userRemove.id);
      await interaction.reply(
        `Użytkownik ${userRemove.username} został usunięty z listy wykluczonych.`
      );
    } else {
      await interaction.reply("Podano nieprawidłową komendę lub wartość.");
    }
  }
});

async function fetchSpotifyActivities() {
  const guild = client.guilds.cache.get(process.env.GUILD_ID as string);
  if (!guild) return console.error("Nie znaleziono serwera");

  const channel = guild.channels.cache.get(
    process.env.CHANNEL_ID as string
  ) as TextChannel;
  if (!channel)
    return console.error("Nie znaleziono kanału lub kanał nie jest tekstowy");

  let messageChanged = false;

  const embed = new EmbedBuilder()
    .setTitle("🎵 **Aktywności Spotify** 🎵")
    .setColor(0x1db954)
    .setTimestamp();

  await guild.members
    .fetch()
    .then((members) => {
      members.forEach((member) => {
        if (excludedUsers.has(member.id)) return; // Pomijanie wykluczonych użytkowników

        const activities = member.presence?.activities || [];
        const spotifyActivity = activities.find(
          (activity) => activity.name === "Spotify" && activity.type === 2
        );

        if (spotifyActivity) {
          const song = spotifyActivity.details || "Nieznana";
          const artist = spotifyActivity.state || "Nieznany";
          const previousStatus = previousStatuses.get(member.id);

          if (
            !previousStatus ||
            previousStatus.song !== song ||
            previousStatus.artist !== artist
          ) {
            embed.addFields({
              name: member.displayName,
              value: `Słucha **${song}** autorstwa **${artist}**`,
              inline: false,
            });
            previousStatuses.set(member.id, { song, artist });
            messageChanged = true;
          }
        } else {
          previousStatuses.delete(member.id);
        }
      });

      if (messageChanged) {
        channel.send({ embeds: [embed] }).catch(console.error);
      }
    })
    .catch(console.error);
}

client.login(process.env.DISCORD_TOKEN);
