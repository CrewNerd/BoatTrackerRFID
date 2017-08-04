import * as fs from "fs";

/** Specifies the configuration of a door (also known as a "read zone") within a
 * given RFID reader. Each door has a name and two antennas, identified by their
 * number.
 */
export interface IDoorConfig {
    name: string;
    innerAntenna: number;
    outerAntenna: number;
}

/** Specified the configuration of a single reader. Readers must have a name,
 * a type, and at least one door. They may also have information about how to
 * communicate with them.
 */
export interface IReaderConfig {
    name: string;
    type: string;
    username?: string;
    password?: string;
    address?: string;
    port?: number;
    antennas: number[];
    doors: IDoorConfig[];
}

/** Specifies the top-level RFID configuration for a club. Provides the club ID, the
 * host URL where events will be sent, a password for authenticating with the server,
 * and the configuration of each installed reader.
 */
export interface IConfig {
    clubId: string;
    hostUrl: string;
    rfidPassword: string;
    readers: IReaderConfig[];
}

/** Reads an RFID configuration from the given file (config.json by default) and
 * returns an IConfig. */
export function ReadConfiguration(file: string = "config.json"): IConfig {
    const configData: string = fs.readFileSync(file, { encoding: "utf8" });

    // todo: validate the config format
    let config: IConfig = <IConfig> JSON.parse(configData);

    for (const reader of config.readers) {
        reader.antennas = [];
        for (const door of reader.doors) {
            reader.antennas.push(door.innerAntenna);
            reader.antennas.push(door.outerAntenna);
        }
    }

    return config;
}