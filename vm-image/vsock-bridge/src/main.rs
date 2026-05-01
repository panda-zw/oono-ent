// vsock-bridge — runs inside the Oono Ent guest VM.
// Listens on AF_VSOCK port (default 6878) and forwards each accepted connection
// to localhost:6878 (where Acestream Engine is listening). Lets the macOS host
// reach the engine through Apple Virtualization framework's VSOCK transport.

use std::net::TcpStream;
use std::thread;
use std::time::Duration;

use vsock::{VsockListener, VsockStream, VMADDR_CID_ANY};

fn main() {
    let port: u32 = std::env::var("OONO_VSOCK_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(6878);
    let target = std::env::var("OONO_TCP_TARGET")
        .unwrap_or_else(|_| "127.0.0.1:6878".into());

    let listener = match VsockListener::bind_with_cid_port(VMADDR_CID_ANY, port) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[vsock-bridge] bind VSOCK :{port} failed: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("[vsock-bridge] listening on VSOCK :{port}, forwarding to {target}");

    for incoming in listener.incoming() {
        let conn = match incoming {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[vsock-bridge] accept error: {e}");
                continue;
            }
        };
        let target = target.clone();
        thread::spawn(move || handle(conn, target));
    }
}

fn handle(vs: VsockStream, target: String) {
    eprintln!("[vsock-bridge] new connection, dialing {target}");
    let tcp = (0..20).find_map(|_| match TcpStream::connect(&target) {
        Ok(s) => Some(s),
        Err(_) => {
            thread::sleep(Duration::from_millis(500));
            None
        }
    });
    let Some(tcp) = tcp else {
        eprintln!("[vsock-bridge] TCP target unreachable: {target}");
        return;
    };
    eprintln!("[vsock-bridge] connected to {target}, splicing");

    let vs_clone = match vs.try_clone() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[vsock-bridge] vs.try_clone failed: {e}");
            return;
        }
    };
    let tcp_clone = match tcp.try_clone() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[vsock-bridge] tcp.try_clone failed: {e}");
            return;
        }
    };

    let mut a_r = vs;
    let mut a_w = tcp_clone;
    let mut b_r = tcp;
    let mut b_w = vs_clone;

    let h = thread::spawn(move || {
        let n = std::io::copy(&mut b_r, &mut b_w);
        eprintln!("[vsock-bridge] tcp->vsock copy ended: {:?}", n);
    });
    let n = std::io::copy(&mut a_r, &mut a_w);
    eprintln!("[vsock-bridge] vsock->tcp copy ended: {:?}", n);
    let _ = h.join();
}
