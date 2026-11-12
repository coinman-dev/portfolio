fn main() {
    // The CoW Swap view (Linux, macOS) reaches the app only through this
    // plugin's two commands; capabilities/cow-swap.json grants them to
    // https://swap.cow.fi in the "cowswap" webview and to nothing else.
    // Jumper's view uses the same route on Linux and macOS (jumper-bridge,
    // capabilities/jumper.json); on Windows it keeps its wallet protocol.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin(
                "cow-bridge",
                tauri_build::InlinedPlugin::new()
                    .commands(&["rpc", "state"])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            )
            .plugin(
                "jumper-bridge",
                tauri_build::InlinedPlugin::new()
                    .commands(&["rpc", "state", "storage"])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            ),
    )
    .expect("failed to run tauri-build");
}
