// This script simulates the desired user flow
// --- Configuration ---
const YOUR_WALLET = "0x44b4b06D3446fF81c5c0E660d22CD51d4d9c3171";
const DEPOSIT_AMOUNT = 10.0;
const API_CALLS = [
  {
    cmd: "hookpay call weather-api --city Dhanbad",
    cost: 0.001,
    delay: 800,
    response: '{ "city": "Dhanbad", "temp_c": 24, "conditions": "Clear" }',
  },
  {
    cmd: "hookpay call ai-inference --prompt 'Hello'",
    cost: 0.05,
    delay: 1500,
    response: '{ "completion": "Hello! How can I assist you today?" }',
  },
  {
    cmd: "hookpay call weather-api --city Mumbai",
    cost: 0.001,
    delay: 800,
    response: '{ "city": "Mumbai", "temp_c": 29, "conditions": "Hazy" }',
  },
  {
    cmd: "hookpay call stock-price --ticker ETH",
    cost: 0.002,
    delay: 600,
    response: '{ "ticker": "ETH", "price": 3012.45 }',
  },
  {
    cmd: "hookpay call ai-inference --prompt 'What is Yellow?'",
    cost: 0.05,
    delay: 1800,
    response:
      '{ "completion": "Yellow is a Layer-2 state channel network for..." }',
  },
];

const FAKE_APIS = [
  ["API Name", "Cost (USDC)", "Description"],
  ["weather-api", "$0.001", "Get real-time weather data"],
  ["ai-inference", "$0.050", "Run an AI model inference"],
  ["stock-price", "$0.002", "Get latest stock market data"],
  ["geo-location", "$0.005", "Convert address to lat/long"],
];

// --- Simulation Helpers ---
// (Using ANSI escape codes for color)
const color = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Prints the fake command prompt
function printCommand(cmd) {
  console.log(`\n${color.cyan}$ ${cmd}${color.reset}`);
}

// Prints the tool's output
function printOutput(msg) {
  console.log(msg);
}

// Prints a loading spinner
async function printLoader(duration, msg = "Processing on-chain transaction...") {
  const frames = ["|", "/", "—", "\\"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${color.yellow}⏳ ${msg} ${frames[i++ % 4]}`);
  }, 100);
  await sleep(duration);
  clearInterval(interval);
  process.stdout.write("\r" + " ".repeat(msg.length + 5) + "\r"); // Clear line
}

// Prints the periodic summary
function printSummary(spent, remaining) {
  console.log(
    `${color.yellow}📊 [LOG] Total Spent: $${spent.toFixed(
      4
    )} | Off-Chain Balance: $${remaining.toFixed(4)}${color.reset}`
  );
}

// Prints a formatted table
function printTable(data) {
  const headers = data[0];
  const rows = data.slice(1);
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  // Print header
  console.log(
    `  ${headers
      .map((h, i) => h.padEnd(colWidths[i]))
      .join(" | ")}`
  );
  // Print separator
  console.log(
    `  ${colWidths.map((w) => "-".repeat(w)).join("-+-")}`
  );
  // Print rows
  rows.forEach((row) => {
    console.log(
      `  ${row
        .map((r, i) => r.padEnd(colWidths[i]))
        .join(" | ")}`
    );
  });
}

async function simulate() {
  console.clear();
  printOutput("🚀 Welcome to the HookPay!");
  await sleep(1500);

  // 1. Login
  printCommand("hookpay login");
  await sleep(500);
  printOutput(`Authenticating with wallet ${YOUR_WALLET}...`);
  await sleep(1000);
  printOutput(
    `${color.green}✅ Login successful! Session token saved.${color.reset}`
  );
  await sleep(1000);

  // 2. Deposit
  printCommand(`hookpay deposit --amount ${DEPOSIT_AMOUNT} --token USDC`);
  await sleep(500);
  printOutput(
    `Submitting on-chain deposit for ${DEPOSIT_AMOUNT} USDC to Yellow Custody Contract...`
  );
  await printLoader(3000, "Processing on-chain transaction... (1/2)");
  printOutput(
    `${color.green}✅ Transaction confirmed! ${DEPOSIT_AMOUNT.toFixed(
      2
    )} USDC deposited into session.${color.reset}`
  );
  printOutput(
    `Your off-chain balance is now ${DEPOSIT_AMOUNT.toFixed(2)} USDC.`
  );
  await sleep(1500);

  // 3. Explore APIs
  printCommand("hookpay explore");
  await sleep(500);
  printOutput("Fetching available APIs from provider registry...");
  await sleep(1000);
  printTable(FAKE_APIS);
  await sleep(2000);

  // 4. API Calls Loop
  let balance = DEPOSIT_AMOUNT;
  let totalSpent = 0.0;

  for (const call of API_CALLS) {
    printCommand(call.cmd);
    await sleep(500);
    printOutput(
      `${color.gray}► [Off-Chain] Calling API (Cost: $${call.cost.toFixed(
        4
      )})...${color.reset}`
    );
    await sleep(call.delay);
    printOutput(`◄ Response: ${call.response}`);
    
    // Update balance
    balance -= call.cost;
    totalSpent += call.cost;

    // Print summary log
    printSummary(totalSpent, balance);
    await sleep(1500); // Pause to let the user read the summary
  }

  // 5. Final Settlement
  printCommand("hookpay settle");
  await sleep(500);
  printOutput(
    `Submitting final off-chain state (Total Spent: $${totalSpent.toFixed(
      4
    )}) for on-chain settlement...`
  );
  await printLoader(3500, "Processing on-chain transaction... (2/2)");
  printOutput(`${color.green}✅ Settlement Complete!${color.reset}`);
  printOutput(
    `- ${color.green}$${balance.toFixed(
      4
    )} USDC returned to your wallet ${YOUR_WALLET}.${color.reset}`
  );
  printOutput(
    `- $${totalSpent.toFixed(4)} USDC paid to API Provider.`
  );
  await sleep(1000);
}

simulate();