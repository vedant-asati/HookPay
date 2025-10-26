import dotenv from "dotenv";
import ClearNodeClient from "./ClearNodeClient.js";
import { RPCChannelStatus } from "@erc7824/nitrolite";
import { ethers } from "ethers";

dotenv.config();

/**
 * Display application banner
 */
function displayBanner() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("         ClearNode Channel Manager v1.0");
  console.log("═══════════════════════════════════════════════════\n");
}

/**
 * Display channel details in a formatted way
 */
function displayChannelDetails(channel, balances = null) {
  console.log("\n┌─────────────────────────────────────────────────┐");
  console.log(`│ Channel ID: ${channel.channel_id}`);
  console.log(`│ Status: ${channel.status}`);
  console.log(`│ Token: ${channel.token}`);

  if (channel.participants && channel.participants.length > 0) {
    console.log(`│ Participants:`);
    channel.participants.forEach((p, i) => {
      console.log(`│   ${i + 1}. ${p}`);
    });
  }

  if (balances) {
    console.log(`│ Balances:`);
    if (balances.balances && balances.balances.length > 0) {
      balances.balances.forEach((balance) => {
        console.log(`│   - Asset: ${balance.asset || "N/A"}`);
        console.log(`│     Amount: ${balance.amount || "0"}`);
      });
    } else {
      console.log(`│   No balance data available`);
    }
  }
  console.log("└─────────────────────────────────────────────────┘");
}

/**
 * Display summary statistics
 */
function displaySummary(channels) {
  const openCount = channels.filter(
    (c) => c.status === RPCChannelStatus.Open
  ).length;
  const closedCount = channels.filter(
    (c) => c.status === RPCChannelStatus.Closed
  ).length;
  const pendingCount = channels.length - openCount - closedCount;

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║                  CHANNEL SUMMARY                  ║");
  console.log("╠═══════════════════════════════════════════════════╣");
  console.log(`║ Total Channels:    ${String(channels.length).padEnd(31)}║`);
  console.log(`║ Open Channels:     ${String(openCount).padEnd(31)}║`);
  console.log(`║ Closed Channels:   ${String(closedCount).padEnd(31)}║`);
  console.log(`║ Pending Channels:  ${String(pendingCount).padEnd(31)}║`);
  console.log("╚═══════════════════════════════════════════════════╝\n");
}

/**
 * Fetch and display all channels with their balances
 */
async function displayAllChannelsWithBalances(client) {
  console.log("\n📡 Fetching channels...");
  const channels = await client.getChannels();
  console.log(channels);
  if (!channels || channels?.length === 0) {
    console.log("\n❌ No channels found for this wallet.");
    return;
  }

  displaySummary(channels);

  // Display all channels
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];
    console.log(`\n[${i + 1}/${channels.length}] Processing channel...`);

    // Fetch balances for open channels
    let balances = null;
    if (channel.status === RPCChannelStatus.Open) {
      try {
        console.log("   💰 Fetching balances...");
        balances = await client.getLedgerBalances(channel.channel_id);
      } catch (error) {
        console.error(`   ⚠️  Failed to fetch balances: ${error.message}`);
      }
    }

    displayChannelDetails(channel, balances);
  }
}

/**
 * Get and display ClearNode configuration
 */
async function displayConfiguration(client) {
  try {
    console.log("\n⚙️  Fetching ClearNode configuration...");
    const config = await client.getConfig();

    console.log("\n╔═══════════════════════════════════════════════════╗");
    console.log("║              CLEARNODE CONFIGURATION              ║");
    console.log("╠═══════════════════════════════════════════════════╣");
    console.log(
      `║ ${JSON.stringify(config, null, 2).split("\n").join("\n║ ")}`
    );
    console.log("╚═══════════════════════════════════════════════════╝");
  } catch (error) {
    console.error(`⚠️  Failed to fetch configuration: ${error.message}`);
  }
}

/**
 * Display connection information
 */
function displayConnectionInfo(client) {
  console.log("\n✅ Successfully connected and authenticated!");
  console.log("\n┌─────────────────────────────────────────────────┐");
  console.log("│              CONNECTION DETAILS                 │");
  console.log("├─────────────────────────────────────────────────┤");
  console.log(`│ Wallet Address: ${client.getAddress()}`);
  console.log(`│ Session Key:    ${client.getSessionKey()}`);
  console.log(`│ Connected:      ${client.isConnected}`);
  console.log(`│ Authenticated:  ${client.isAuthenticated}`);
  console.log("└─────────────────────────────────────────────────┘");
}

/**
 * Main application entry point
 */
async function main() {
  displayBanner();

  // Validate environment variables
  if (!process.env.WS_RPC_URL || !process.env.PRIVATE_KEY) {
    console.error("❌ Error: Missing required environment variables!");
    console.error(
      "   Please ensure WS_RPC_URL and PRIVATE_KEY are set in .env file"
    );
    process.exit(1);
  }

  const primaryWallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const sessionWallet = ethers.Wallet.createRandom();
  // Create client with configuration
  const client = new ClearNodeClient(
    process.env.WS_RPC_URL,
    primaryWallet,
    sessionWallet,
    {
      reconnect: {
        maxAttempts: 3,
        interval: 3000,
      },
      timeout: {
        connection: 15000,
        request: 30000,
      },
      auth: {
        appName: "ClearNode Channel Manager",
        scope: "console",
        application: "0x0000000000000000000000000000000000000000",
        expireDays: 10,
      },
    }
  );

  // Add custom event handlers for better UX
  client.on("reconnecting", ({ attempt, delay }) => {
    console.log(`\n🔄 Reconnection attempt ${attempt}... (waiting ${delay}ms)`);
  });

  try {
    // Connect and authenticate
    console.log("🔌 Connecting to ClearNode...");
    await client.connect();

    // Display connection info
    displayConnectionInfo(client);

    // Display all channels with balances
    await displayAllChannelsWithBalances(client);

    // Optionally display configuration
    await displayConfiguration(client);

    console.log("\n✨ All operations completed successfully!");
  } catch (error) {
    console.error("\n❌ Fatal Error:", error.message);
    console.error("\nStack Trace:", error.stack);
    process.exit(1);
  } finally {
    // Always disconnect
    console.log("\n🔌 Disconnecting from ClearNode...");
    client.disconnect();
    console.log("👋 Goodbye!\n");
  }
}

/**
 * Handle graceful shutdown
 */
function setupGracefulShutdown() {
  const shutdown = (signal) => {
    console.log(`\n\n⚠️  Received ${signal}. Shutting down gracefully...`);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("\n❌ Uncaught Exception:", error);
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason, promise) => {
    console.error("\n❌ Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
  });
}

// Setup graceful shutdown handlers
setupGracefulShutdown();

// Run the application
console.log("🚀 Starting ClearNode Channel Manager...\n");
main().catch((error) => {
  console.error("\n💥 Application crashed:", error);
  process.exit(1);
});
