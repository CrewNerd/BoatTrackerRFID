import { IConfig, IReaderConfig } from "./ConfigManager";
import { AlienReader } from "./AlienReader";

/** The base class for all RFID readers. Every reader can be started and stopped. */
export abstract class RfidReader {
    abstract async StartReader(): Promise<void>;
    abstract StopReader(): void;

    protected readonly config: IConfig;
    protected readonly readerConfig: IReaderConfig;

    protected constructor(config: IConfig, readerConfig: IReaderConfig) {
        this.config = config;
        this.readerConfig = readerConfig;
    }
}