mod dkg;
mod sign;
mod store;
mod tx;
mod wallet;

use clap::{Parser, Subcommand};
use eyre::Result;

use store::Store;

#[derive(Parser)]
#[command(name = "zigs", about = "t-of-n FROST multisig for Zcash Orchard (prototype)")]
struct Cli {
    /// Shared working directory that stands in for the network relay.
    #[arg(long, default_value = "wallet-data")]
    dir: String,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Coordinator: define the group (names in id order) and the threshold.
    Init {
        #[arg(long, value_delimiter = ',')]
        names: Vec<String>,
        #[arg(long)]
        threshold: u16,
    },
    /// Participant: DKG round 1 (broadcast commitment).
    DkgRound1 {
        #[arg(long)]
        id: u16,
    },
    /// Participant: DKG round 2 (send secret shares).
    DkgRound2 {
        #[arg(long)]
        id: u16,
    },
    /// Participant: DKG finish (derive own key share and group key).
    DkgFinish {
        #[arg(long)]
        id: u16,
    },
    /// Coordinator: check all group keys match, build the shared Orchard wallet.
    WalletCreate {
        #[arg(long, default_value = "testnet")]
        network: String,
    },
    /// Participant: check the published wallet really uses our group key.
    WalletVerify {
        #[arg(long)]
        id: u16,
    },
    /// Demo only: fabricate a note owned by the wallet and build an unsigned,
    /// proven PCZT that spends it on a local regtest chain.
    TxDemoCreate {
        #[arg(long)]
        session: String,
        /// Amount to send, in zatoshis.
        #[arg(long, default_value_t = 100_000)]
        amount: u64,
        /// Value of the fabricated input note, in zatoshis.
        #[arg(long, default_value_t = 1_000_000)]
        note_value: u64,
        /// Shielded pool to spend from.
        #[arg(long, value_enum, default_value = "ironwood")]
        pool: tx::DemoPool,
    },
    /// Coordinator: import an unsigned PCZT from any wallet (e.g. Zashi/Zallet).
    TxImport {
        #[arg(long)]
        session: String,
        #[arg(long)]
        pczt: String,
    },
    /// Participant: inspect the transaction and publish nonce commitments.
    SignCommit {
        #[arg(long)]
        session: String,
        #[arg(long)]
        id: u16,
    },
    /// Coordinator: pick signers, build per-spend signing packages.
    SignPackage {
        #[arg(long)]
        session: String,
        #[arg(long, value_delimiter = ',')]
        signers: Vec<u16>,
    },
    /// Participant: independently verify the package, produce signature shares.
    SignShare {
        #[arg(long)]
        session: String,
        #[arg(long)]
        id: u16,
    },
    /// Coordinator: aggregate, attach signatures, extract the final transaction.
    SignAggregate {
        #[arg(long)]
        session: String,
    },
    /// Run the whole ceremony end to end with N simulated participants.
    Demo {
        #[arg(long, value_delimiter = ',', default_value = "alice,bob,carol")]
        names: Vec<String>,
        #[arg(long, default_value_t = 2)]
        threshold: u16,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let store = Store::new(&cli.dir);
    match cli.cmd {
        Cmd::Init { names, threshold } => {
            let cfg = dkg::init(&store, names, threshold)?;
            println!("group: {}-of-{} {:?}", cfg.min_signers, cfg.max_signers, cfg.names);
        }
        Cmd::DkgRound1 { id } => {
            dkg::round1(&store, id)?;
            println!("participant {id}: round 1 commitment published");
        }
        Cmd::DkgRound2 { id } => {
            dkg::round2(&store, id)?;
            println!("participant {id}: round 2 shares sent");
        }
        Cmd::DkgFinish { id } => {
            let p = dkg::finish(&store, id)?;
            println!(
                "participant {id}: key share ready, group key {}",
                hex::encode(dkg::group_vk_bytes(&p)?)
            );
        }
        Cmd::WalletCreate { network } => {
            dkg::publish_group_key(&store)?;
            let w = wallet::create(&store, wallet::network_from_str(&network)?)?;
            println!("{}", serde_json::to_string_pretty(&w)?);
        }
        Cmd::WalletVerify { id } => {
            wallet::verify_as_participant(&store, id)?;
            println!("participant {id}: wallet verified");
        }
        Cmd::TxDemoCreate {
            session,
            amount,
            note_value,
            pool,
        } => {
            tx::demo_create(&store, &session, amount, note_value, pool)?;
        }
        Cmd::TxImport { session, pczt } => {
            tx::import(&store, &session, &pczt)?;
        }
        Cmd::SignCommit { session, id } => sign::commit(&store, &session, id)?,
        Cmd::SignPackage { session, signers } => sign::package(&store, &session, &signers)?,
        Cmd::SignShare { session, id } => sign::share(&store, &session, id)?,
        Cmd::SignAggregate { session } => sign::aggregate(&store, &session)?,
        Cmd::Demo { names, threshold } => demo(&store, names, threshold)?,
    }
    Ok(())
}

fn demo(store: &Store, names: Vec<String>, threshold: u16) -> Result<()> {
    let n = names.len() as u16;
    println!("== 1. Group setup: {threshold}-of-{n} {names:?}");
    dkg::init(store, names.clone(), threshold)?;

    println!("\n== 2. Distributed key generation (no dealer, nobody learns the key)");
    for id in 1..=n {
        dkg::round1(store, id)?;
    }
    println!("   round 1: {n} commitments + proofs of knowledge broadcast");
    for id in 1..=n {
        dkg::round2(store, id)?;
    }
    println!("   round 2: {} point-to-point secret shares sent", n * (n - 1));
    for id in 1..=n {
        let p = dkg::finish(store, id)?;
        println!(
            "   {} (id {id}) group key: {}",
            names[id as usize - 1],
            hex::encode(dkg::group_vk_bytes(&p)?)
        );
    }

    println!("\n== 3. Shared Orchard wallet");
    dkg::publish_group_key(store)?;
    let w = wallet::create(store, zcash_protocol::consensus::Network::TestNetwork)?;
    for id in 1..=n {
        wallet::verify_as_participant(store, id)?;
    }
    println!("   address (testnet): {}", w.address);
    println!("   UFVK: {}", w.ufvk);
    println!("   every participant verified ak == their DKG group key");

    // The *last* `threshold` participants sign, to show any quorum works.
    let signers: Vec<u16> = ((n - threshold + 1)..=n).collect();
    for (step, pool, session) in [
        (4, tx::DemoPool::Ironwood, "demo-ironwood"),
        (5, tx::DemoPool::Orchard, "demo-orchard"),
    ] {
        println!("\n== {step}. Spend from the wallet ({pool:?} pool), signers {signers:?}");
        tx::demo_create(store, session, 100_000, 1_000_000, pool)?;
        for id in &signers {
            sign::commit(store, session, *id)?;
        }
        sign::package(store, session, &signers)?;
        for id in &signers {
            sign::share(store, session, *id)?;
        }
        sign::aggregate(store, session)?;
    }
    Ok(())
}
