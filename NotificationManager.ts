import { IReaderConfig, IDoorConfig } from "./ConfigManager";

class Notification {
    constructor(notification: string, readerConfig: IReaderConfig) {
        const notificationFields: string[] = notification.split(",");

        if (notificationFields.length !== 5) {
            throw "Invalid notification string";
        }

        this.readerConfig = readerConfig;
        this.reader = notificationFields[1];
        this.antenna = Number(notificationFields[2]);
        this.tagId = notificationFields[3];
        this.rssi = Number(notificationFields[4]);
    }

    private readerConfig: IReaderConfig;
    public reader: string;
    public antenna: number;
    public tagId: string;
    public rssi: number;

    get AntennaType():AntennaType {
        for (const door of this.readerConfig.doors) {
            if (door.innerAntenna === this.antenna) {
                return AntennaType.Inner;
            } else if (door.outerAntenna === this.antenna) {
                return AntennaType.Outer;
            }
        }

        throw "Error: antenna not found!";
    }
}

enum AntennaType {
    Inner,
    Outer
}

enum TagState {
    InnerAntennaOutbound,
    InnerAntennaInbound,
    OuterAntennaOutbound,
    OuterAntennaInbound,
    OutPending,
    InPending
}

const NullTransitionTimeout: number = 2000;
const OutboundTransitionTimeout: number = 3000;
const InboundTransitionTimeout: number = 3000;

class TagRecord {
    constructor(state: TagState, lastUpdate: number) {
        this.state = state;
        this.lastUpdate = lastUpdate;
    }

    public state: TagState;
    public lastUpdate: number;
}

export class NotificationManager {
    constructor(readerConfig: IReaderConfig) {
        this.readerConfig = readerConfig;
        this.tags = new Map<string, TagRecord>();
    }

    private tags: Map<string, TagRecord>;

    private readerConfig: IReaderConfig;

    public processNotifications(notifications: string[]): void {
        for (const notification of notifications) {
            console.warn(notification);
            this.processTagRead(new Notification(notification, this.readerConfig));
        }

        this.processTimeouts();
    }

    private processTagRead(n: Notification): void {
        // if the tag isn't being tracked, set its initial state.
        if (!this.tags.has(n.tagId)) {
            this.tags.set(n.tagId, new TagRecord(
                n.AntennaType === AntennaType.Inner ? TagState.InnerAntennaOutbound : TagState.OuterAntennaInbound,
                Date.now()
            ));
            return;
        }

        // process tag state update
        let tagRecord: TagRecord = <TagRecord>this.tags.get(n.tagId);
        tagRecord.lastUpdate = Date.now();

        switch (tagRecord.state) {
            case TagState.InnerAntennaInbound:
                switch (n.AntennaType) {
                    case AntennaType.Inner:
                        // no state change
                        break;
                    case AntennaType.Outer:
                        tagRecord.state = TagState.OuterAntennaInbound;
                        break;
                }
                break;

            case TagState.InnerAntennaOutbound:
                switch (n.AntennaType) {
                    case AntennaType.Inner:
                        // no state chage
                        break;
                    case AntennaType.Outer:
                        tagRecord.state = TagState.OuterAntennaOutbound;
                        break;
                }
                break;

            case TagState.OuterAntennaInbound:
                switch (n.AntennaType) {
                    case AntennaType.Inner:
                        tagRecord.state = TagState.InnerAntennaInbound;
                        break;
                    case AntennaType.Outer:
                        // no state change
                        break;
                }
                break;

            case TagState.OuterAntennaOutbound:
                switch (n.AntennaType) {
                    case AntennaType.Inner:
                        tagRecord.state = TagState.InnerAntennaOutbound;
                        break;
                    case AntennaType.Outer:
                        // no state change
                        break;
                }
                break;

            case TagState.InPending:
                switch (n.AntennaType) {
                    case AntennaType.Inner:
                        tagRecord.state = TagState.InnerAntennaInbound;
                        break;
                    case AntennaType.Outer:
                        tagRecord.state = TagState.OuterAntennaInbound;
                        break;
                }
                break;

            case TagState.OutPending:
                switch (n.AntennaType) {
                    case AntennaType.Inner:
                        tagRecord.state = TagState.InnerAntennaOutbound;
                        break;
                    case AntennaType.Outer:
                        tagRecord.state = TagState.OuterAntennaOutbound;
                        break;
                }
                break;
        }
    }

    private processTimeouts(): void {
        const now: number = Date.now();

        this.tags.forEach((value: TagRecord, key: string) => {
            this.checkForTagTimeout(key, value, now);
        });
    }

    private checkForTagTimeout(tagId: string, tagRecord: TagRecord, now: number): void {
        const elapsedTime: number = now - tagRecord.lastUpdate;
        switch (tagRecord.state) {
            case TagState.InnerAntennaInbound:
                if (elapsedTime > NullTransitionTimeout) {
                    tagRecord.state = TagState.InPending;
                    tagRecord.lastUpdate = now;
                }
                break;

            case TagState.InnerAntennaOutbound:
                if (elapsedTime > NullTransitionTimeout) {
                    this.tags.delete(tagId);
                }
                break;

            case TagState.InPending:
                if (elapsedTime > InboundTransitionTimeout) {
                    // todo: send a message to the boattracker service
                    console.warn(`Ingress: ${tagId}`);
                    this.tags.delete(tagId);
                }
                break;

            case TagState.OuterAntennaInbound:
                if (elapsedTime > NullTransitionTimeout) {
                    this.tags.delete(tagId);
                }
                break;

            case TagState.OuterAntennaOutbound:
                if (elapsedTime > NullTransitionTimeout) {
                    tagRecord.state = TagState.OutPending;
                    tagRecord.lastUpdate = now;
                }
                break;

            case TagState.OutPending:
                if (elapsedTime > OutboundTransitionTimeout) {
                    // todo: send a message to the boattracker service
                    console.warn(`Egress:  ${tagId}`);
                    this.tags.delete(tagId);
                }
        }
    }
}