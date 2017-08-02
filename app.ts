import { AlienManager } from "./AlienManager";
import { ReadConfiguration, IConfig, IReaderConfig, IDoorConfig } from "./ConfigManager";

async function main(): Promise<void> {
    const config: IConfig = ReadConfiguration();

    // take the first reader for now...
    const reader: IReaderConfig = config.readers[0];
    let mgr: AlienManager = new AlienManager(config, reader);

    await mgr.StartServer();
}

main();