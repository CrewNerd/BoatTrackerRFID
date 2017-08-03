import * as fs from "fs";

export interface IDoorConfig {
    name: string;
    innerAntenna: number;
    outerAntenna: number;
}

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

export interface IConfig {
    clubId: string;
    hostUrl: string;
    rfidPassword: string;
    readers: IReaderConfig[];
}

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