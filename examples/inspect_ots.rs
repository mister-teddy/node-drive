/// Simple utility to inspect OpenTimestamps files
///
/// Usage: cargo run --example inspect_ots <path-to-ots-file>
use opentimestamps::DetachedTimestampFile;
use std::env;
use std::fs::File;
use std::io::BufReader;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() != 2 {
        eprintln!("Usage: {} <ots-file>", args[0]);
        eprintln!("\nExample: cargo run --example inspect_ots myfile.txt.ots");
        std::process::exit(1);
    }

    let filename = &args[1];

    match inspect_ots_file(filename) {
        Ok(()) => {}
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}

fn inspect_ots_file(filename: &str) -> Result<(), Box<dyn std::error::Error>> {
    println!("Inspecting OTS file: {}\n", filename);

    let file = File::open(filename)?;
    let file_size = file.metadata()?.len();
    let reader = BufReader::new(file);

    let detached = DetachedTimestampFile::from_reader(reader)?;

    println!("File size: {} bytes", file_size);
    println!("Digest type: {}", detached.digest_type);
    println!("\n{}", detached);

    Ok(())
}
