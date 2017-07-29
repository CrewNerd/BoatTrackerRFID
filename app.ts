import { AlienManager } from "./AlienManager";
import { ReadConfiguration, IConfig, IReaderConfig, IDoorConfig } from "./ConfigManager";

function doSetup(): void {
    const config: IConfig = ReadConfiguration();

    // take the first reader for now...
    const reader: IReaderConfig = config.readers[0];
    let mgr: AlienManager = new AlienManager(reader);

    mgr.RunSetup();
}

function doListen(): void {
}


function main(): void {
    if (process.argv.length !== 3) {
        usage();
    }

    switch (process.argv[2]) {
        case "setup":
            doSetup();
            break;

        case "listen":
            doListen();
            break;

        default:
            usage();
    }
}

function usage(): void {
    console.error("usage: node app setup|listen");
    process.exit(1);
}

main();