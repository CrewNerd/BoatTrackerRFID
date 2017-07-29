import { AlienManager } from "./AlienManager";
import { ReadConfiguration, IConfig, IReaderConfig, IDoorConfig } from "./ConfigManager";
import * as ReadLine from 'readline-sync';

async function main(): Promise<void> {
    const config: IConfig = ReadConfiguration();

    // take the first reader for now...
    const reader: IReaderConfig = config.readers[0];
    let mgr: AlienManager = new AlienManager(reader);

    await mgr.StartServer();

    //ReadLine.question("Press <enter> to stop the server...");

    //mgr.StopServer();
}

main();