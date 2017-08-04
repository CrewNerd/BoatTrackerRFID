import { RfidReader } from "./RfidReader";
import { ReadConfiguration, IConfig, IReaderConfig, IDoorConfig } from "./ConfigManager";

async function main(): Promise<void> {
    const config: IConfig = ReadConfiguration();

    let managers: Map<string, RfidReader> = new Map<string, RfidReader>();

    // start all readers
    for (const reader of config.readers) {
        let mgr: RfidReader = RfidReader.CreateReader(config, reader);
        managers.set(reader.name, mgr);
        await mgr.StartReader();
    }
}

main();