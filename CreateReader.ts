import { IConfig, IReaderConfig } from "./ConfigManager";
import { RfidReader } from "./RfidReader";
import { AlienReader } from "./AlienReader";

/** Creates an instance of the appropriate RfidReader subclass based
 * on the reader type found in the given IReaderConfig.
 */
export function CreateReader(config: IConfig, readerConfig: IReaderConfig): RfidReader {
    switch (readerConfig.type) {
        case "Alien":
            return new AlienReader(config, readerConfig);

        default:
            throw `Unknown reader type: ${readerConfig.type}`
    }
}