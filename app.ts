import { AlienManager } from './AlienManager';

function doSetup(): void {
    let mgr: AlienManager = new AlienManager();

    mgr.Connect((error: Error | null) => {
        if (error !== null) {
            console.error("Connect error");
        } else {
            mgr.RunCommand("t", (error: Error | null) => {
                if (error !== null) {
                    console.error("Command failed");
                } else {
                    console.info("Command finished");
                }
            });
        }

        console.warn("Connect finished");
    })
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