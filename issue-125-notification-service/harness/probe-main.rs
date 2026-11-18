fn main() {
    match notify_rust::get_server_information() {
        Ok(info) => println!("OK server={} vendor={} version={}", info.name, info.vendor, info.version),
        Err(e) => println!("ERR The desktop notification service is unavailable. Check your notification daemon and session bus: {e}"),
    }
}
