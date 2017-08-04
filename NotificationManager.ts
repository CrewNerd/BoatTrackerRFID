import { IConfig, IReaderConfig, IDoorConfig } from "./ConfigManager";
import * as request from "request";

enum AntennaType {
    Inner,
    Outer
}

/**
 * Represents a generic notification of a tag read.
 */
export class Notification {
    constructor(readerConfig: IReaderConfig, tagId: string, antenna: number, rssi: number) {
        this.readerConfig = readerConfig;
        this.antenna = antenna
        this.tagId = tagId;
        this.rssi = rssi;
    }

    private readerConfig: IReaderConfig;

    public antenna: number;
    public tagId: string;
    public rssi: number;

    get reader(): string {
        return this.readerConfig.name;
    }

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

    get DoorName(): string {
        for (const door of this.readerConfig.doors) {
            if (door.innerAntenna === this.antenna || door.outerAntenna === this.antenna) {
                return door.name;
            }
        }

        throw "Error: antenna not found!";
    }
}

enum TagState {
    InnerAntennaOutbound,
    InnerAntennaInbound,
    OuterAntennaOutbound,
    OuterAntennaInbound,
    OutPending,
    InPending
}

/** format of the messages we send to the BoatTracker service */
interface IHostEvent {
    EPC: string;
    ReadTime: string;
    Direction: string;
    Location: string;
    ReadZone: string;
}

// a null transition occurs when a tag is not seen at any antenna for this period of time
const NullTransitionTimeout: number = 2000;

// an outbound transition occurs when a tag is in the OutPending state for this time span
const OutboundTransitionTimeout: number = 3000;

// an inbound transition occurs when a tag is in the InPending state for this time span
const InboundTransitionTimeout: number = 3000;

/** used to track tags that have been seen recently by the reader */
class TagRecord {
    constructor(state: TagState, doorName: string, lastUpdate: number) {
        this.state = state;
        this.doorName = doorName;
        this.lastUpdate = lastUpdate;
    }

    public state: TagState;
    public lastUpdate: number;
    public doorName: string;
}

/** the notification manager receives raw notification events from the reader manager
 * and turns them into digested in/out events that are passed along to the BoatTracker
 * service.
 */
export class NotificationManager {
    constructor(config: IConfig, readerConfig: IReaderConfig) {
        this.config = config;
        this.readerConfig = readerConfig;
        this.tags = new Map<string, TagRecord>();
        this.queuedBoatMessages = [];
    }

    private tags: Map<string, TagRecord>;
    private queuedBoatMessages: IHostEvent[];

    private config: IConfig;
    private readerConfig: IReaderConfig;

    /** Process a set of tag notifications.
     * @param notifications A list of notifications to be processed.
     */
    public processNotifications(notifications: Notification[]): void {
        for (const notification of notifications) {
            try {
                this.processTagRead(notification);
            } catch (err) {
                // ignore notifications with invalid formats
            }
        }

        this.processTimeouts();
        this.flushBoatMessages();
    }

    /** Process a read event for a tag. Change the tag state appropriately based on the
     * antenna where the tag was read, and its current state.
     */
    private processTagRead(n: Notification): void {
        // if the tag isn't being tracked, set its initial state.
        if (!this.tags.has(n.tagId)) {
            this.tags.set(n.tagId, new TagRecord(
                n.AntennaType === AntennaType.Inner ? TagState.InnerAntennaOutbound : TagState.OuterAntennaInbound,
                n.DoorName,
                Date.now()
            ));
            return;
        }

        // process tag state update
        let tagRecord: TagRecord = <TagRecord>this.tags.get(n.tagId);
        tagRecord.lastUpdate = Date.now();

        // todo: deal with spurious reads from antennas in adjacent doors

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

    /** Check all recently-observed tags for timeout conditions. */
    private processTimeouts(): void {
        const now: number = Date.now();

        this.tags.forEach((value: TagRecord, key: string) => {
            this.checkForTagTimeout(key, value, now);
        });
    }

    /** Check to see if a timeout condition has been reached for a given tag. */
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

    /** Queue an outgoing message to the BoatTracker service */
    private queueBoatMessage(tagId: string, isEgress: boolean, doorName: string): void {
        this.queuedBoatMessages.push({
            EPC: tagId,
            ReadTime: (new Date()).toISOString(),
            Direction: isEgress ? "OUT" : "IN",
            Location: this.config.clubId,
            ReadZone: doorName
        });
    }

    /** Send pending messages to the server and clear the pending queue */
    private flushBoatMessages(): void {
        if (this.queuedBoatMessages.length > 0) {
            request({
                url: this.config.hostUrl + "/api/rfid/events",
                headers: {
                    "Authorization": `basic ${this.config.clubId}:${this.config.rfidPassword}`,
                },
                method: "POST",
                json: true,
                body: this.queuedBoatMessages
            }, (error: any, response: request.RequestResponse, body: any): void => {
                if (response.statusCode === 200) {
                    // todo - is there a race condition here?
                    this.queuedBoatMessages = [];
                } else {
                    console.error(`Delivery to cloud service failed (status=${response.statusCode}) -- will retry`);
                }
            });
        }
    }
}