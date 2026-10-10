const common = require('oci-common');
const core = require('oci-core');
const fs = require('fs');
const path = require('path');

const COMPARTMENT_ID = process.env.OCI_COMPARTMENT_ID || 'ocid1.tenancy.oc1..aaaaaaaalowxmbpaher4ehnxlizctrjl6yjk3yynkr53q5kbvgnos7ezd62a';
const RETRY_INTERVAL_MS = parseInt(process.env.RETRY_INTERVAL_MS, 10) || 60 * 1000; // 60 seconds
const MAX_RUN_MINUTES = parseInt(process.env.MAX_RUN_MINUTES, 10) || 0; // 0 = infinite (for local)

const provider = new common.ConfigFileAuthenticationDetailsProvider();
const client = new core.ComputeClient(
  { authenticationDetailsProvider: provider },
  { retryConfiguration: { retryCondition: () => false } }
);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
  const time = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Colombo' });
  console.log(`[${time}] ${msg}`);
}

const launchDetails = {
  availabilityDomain: 'QDTs:AP-SINGAPORE-1-AD-1',
  compartmentId: COMPARTMENT_ID,
  displayName: 'zopari-api-server',
  shape: 'VM.Standard.A1.Flex',
  shapeConfig: {
    ocpus: 2,
    memoryInGBs: 12
  },
  createVnicDetails: {
    subnetId: 'ocid1.subnet.oc1.ap-singapore-1.aaaaaaaaeuww7sb6p7xpqmmvosrf5vtbgra6x7zqf6tai6cq5nwtcgp7pg5a',
    assignPublicIp: true,
    displayName: 'zopari-api-vnic'
  },
  sourceDetails: {
    sourceType: 'image',
    imageId: 'ocid1.image.oc1.ap-singapore-1.aaaaaaaapjy3iyr6mjnmsauk77qftljr6ezp5ey3lu6xmqnsfxriylodcxtq'
  },
  metadata: {
    ssh_authorized_keys: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDPim1v/9449uUKMsJVX31qIiyeDEN1C8dVKhTQnXfw/kcULYMT8fadPi0BvreLlYa/yhYwEmtJinVm2XC6QgZelVRZvx5WeSaWvN1tjQYpqkA52QQJylFmWKZOi2XWEtP49v4AWdMPlgq3+XMrU9012ui8GnXsvdmLLIh7JSYBUiwY1Qu8YEdnNyc20oA9fETifROfdPB49bN6JUI90HozI5yhpoxabndChNz4z/1bBDttE9qThdrdwoIo6oQdfZvlO6RsChYsMdC47SlYqKZfTnLWhKZU9TXrwSCNjXqOZkTZJ+2Abp9Z+Ip9oE7gudNDHw7OvXBZ8/KOikJiB58v ssh-key-2026-10-08'
  }
};

async function isInstanceRunning() {
  try {
    const res = await client.listInstances({ compartmentId: COMPARTMENT_ID });
    if (res.items && res.items.length > 0) {
      const active = res.items.find(
        i =>
          i.displayName === 'zopari-api-server' &&
          (i.lifecycleState === 'RUNNING' || i.lifecycleState === 'PROVISIONING' || i.lifecycleState === 'STARTING')
      );
      return active || null;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

async function run() {
  log('====================================================');
  log('🚀 Oracle Cloud ARM Instance Hunter Bot Started!');
  log('🎯 Server: zopari-api-server (2 OCPU / 12 GB RAM)');
  log('📍 Region: ap-singapore-1 (AD-1)');
  log(`⏱️  Retry Interval: ${RETRY_INTERVAL_MS / 1000}s`);
  if (MAX_RUN_MINUTES > 0) {
    log(`⏳ Max Run Duration: ${MAX_RUN_MINUTES} minutes (Cloud Job mode)`);
  }
  log('====================================================');

  const startTime = Date.now();
  let attempt = 1;

  while (true) {
    // Check if instance already exists
    const existing = await isInstanceRunning();
    if (existing) {
      log('🎉🎉🎉 SUCCESS: SERVER IS ALREADY ACTIVE & RUNNING! 🎉🎉🎉');
      log(`Instance ID: ${existing.id}`);
      log(`State: ${existing.lifecycleState}`);
      process.exit(0);
    }

    // Check duration limit if set
    if (MAX_RUN_MINUTES > 0) {
      const elapsedMinutes = (Date.now() - startTime) / (60 * 1000);
      if (elapsedMinutes >= MAX_RUN_MINUTES) {
        log(`⏰ Job reached ${MAX_RUN_MINUTES} minutes limit. Exiting cleanly for next scheduled trigger.`);
        process.exit(0);
      }
    }

    log(`\n[Attempt #${attempt}] Requesting ARM instance directly from Singapore AD-1...`);
    try {
      const res = await client.launchInstance({ launchInstanceDetails: launchDetails });
      const inst = res.instance;
      log('🎉🎉🎉 SUCCESS! SERVER CREATED AND PROVISIONING! 🎉🎉🎉');
      log(`Instance ID: ${inst.id}`);
      log(`Display Name: ${inst.displayName}`);
      log(`State: ${inst.lifecycleState}`);
      process.exit(0);
    } catch (err) {
      if (err.message && err.message.includes('Out of host capacity')) {
        log('⚠️  Singapore AD-1 out of host capacity. Retrying...');
      } else if (err.statusCode === 429) {
        log('⏳ Rate limited. Cooling down for 60s...');
        await sleep(60000);
      } else {
        log(`❌ ${err.message || err}`);
      }
    }

    attempt++;
    log(`Sleeping ${RETRY_INTERVAL_MS / 1000}s before next attempt...`);
    await sleep(RETRY_INTERVAL_MS);
  }
}

run().catch(err => {
  log(`Fatal error: ${err.stack || err}`);
});
