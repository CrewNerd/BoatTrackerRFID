import { AlienManager } from "./AlienManager";
import { ReadConfiguration, IConfig, IReaderConfig, IDoorConfig } from "./ConfigManager";

async function main(): Promise<void> {
    const config: IConfig = ReadConfiguration();

    let managers: Map<string, AlienManager> = new Map<string, AlienManager>();

    // start all readers
    for (const reader of config.readers) {
        let mgr: AlienManager = new AlienManager(config, reader);
        managers.set(reader.name, mgr);
        await mgr.StartReader();
    }
}

main();