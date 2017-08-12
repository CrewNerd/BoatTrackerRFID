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
const OutboundTransitionTimeout: number = 8000;

// an inbound transition occurs when a tag is in the InPending state for this time span
const InboundTransitionTimeout: number = 3000;

// the number of reads by the outer antenna before we consider a transition to be real.
// boats may live near the inner antenna, but the only time we should get multiple hits
// on the outer antenna is when real movement is happening.
const MinimumOuterReadCount: number = 2;

/** used to track tags that have been seen recently by the reader */
class TagRecord {
    constructor(state: TagState, doorName: string, lastUpdate: number) {
        this.state = state;
        this.doorName = doorName;
        this.lastUpdate = lastUpdate;
        this.readsByOuterAntenna = 0;
    }

    public state: TagState;
    public lastUpdate: number;
    public doorName: string;
    public readsByOuterAntenna: number;
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
    }

    private tags: Map<string, TagRecord>;

    private config: IConfig;
    private readerConfig: IReaderConfig;

    /** Process a set of tag notifications.
     * @param notifications A list of notifications to be processed.
     */
    public processNotifications(notifications: Notification[]): void {
        let filteredTags: Map<string, Notification> = new Map<string, Notification>();

        // if a tag is seen by multiple antennas, take only the strongest reading
        for (const notification of notifications) {
            let currentTagRead: Notification | undefined = filteredTags.get(notification.tagId);
            if (currentTagRead === undefined || notification.rssi > currentTagRead.rssi) {
                filteredTags.set(notification.tagId, notification);
            }
        }

        filteredTags.forEach((value: Notification, key: string) => {
            try {
                this.processTagRead(value);
            } catch (err) {
                // ignore notifications with invalid formats
            }
        });

        this.processTimeouts();
    }

    /** Process a read event for a tag. Change the tag state appropriately based on the
     * antenna where the tag was read, and its current state.
     */
    private processTagRead(n: Notification): void {
        // if the tag isn't being tracked, set its initial state.
        const initialState: TagState = n.AntennaType === AntennaType.Inner ? TagState.InnerAntennaOutbound : TagState.OuterAntennaInbound;
        if (!this.tags.has(n.tagId)) {
            this.tags.set(n.tagId, new TagRecord(
                initialState,
                n.DoorName,
                Date.now()
            ));
            console.warn(`${(new Date()).toISOString()}: state change: ${n.tagId}: unseen => ${TagState[initialState]} (rssi=${n.rssi})`);
            return;
        }

        // process tag state update
        let tagRecord: TagRecord = <TagRecord>this.tags.get(n.tagId);
        tagRecord.lastUpdate = Date.now();

        const oldState = tagRecord.state;

        // todo: deal with spurious reads from antennas in adjacent doors

        switch (tagRecord.state) {
            case TagState.InnerAntennaInbound:
                switch (n.AntennaType) {
                    case AntennaType.Inner:
                        // no state change
                        break;
                    case AntennaType.Outer:
                        tagRecord.readsByOuterAntenna++;
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
                        tagRecord.readsByOuterAntenna++;
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
                        tagRecord.readsByOuterAntenna++;
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
                        tagRecord.readsByOuterAntenna++;
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
                        tagRecord.readsByOuterAntenna++;
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
                        tagRecord.readsByOuterAntenna++;
                        tagRecord.state = TagState.OuterAntennaOutbound;
                        break;
                }
                break;
        }

        if (oldState !== tagRecord.state) {
            console.warn(`${(new Date()).toISOString()}: state change: ${n.tagId}: ${TagState[oldState]} => ${TagState[tagRecord.state]} (rssi=${n.rssi})`);
        }
    }

    /** Check all recently-observed tags for timeout conditions. */
    private processTimeouts(): void {
        const now: number = Date.now();

        let pendingHostEvents: IHostEvent[] = [];

        this.tags.forEach((value: TagRecord, key: string) => {
            this.checkForTagTimeout(pendingHostEvents, key, value, now);
        });

        this.sendBoatMessages(pendingHostEvents);
    }

    /** Check to see if a timeout condition has been reached for a given tag. */
    private checkForTagTimeout(pendingHostEvents: IHostEvent[], tagId: string, tagRecord: TagRecord, now: number): void {
        const elapsedTime: number = now - tagRecord.lastUpdate;

        switch (tagRecord.state) {
            case TagState.InnerAntennaInbound:
                if (elapsedTime > NullTransitionTimeout) {
                    // make sure we were seen by the outer antenna a few times or it could be noise
                    if (tagRecord.readsByOuterAntenna >= MinimumOuterReadCount) {
                        tagRecord.state = TagState.InPending;
                        tagRecord.lastUpdate = now;
                        console.warn(`${(new Date()).toISOString()}: state change: ${tagId}: InnerAntennaInbound => InPending`);
                    } else {
                        console.warn(`${(new Date()).toISOString()}: state change: ${tagId}: InnerAntennaInbound => <null> (noise)`);
                        this.tags.delete(tagId);
                    }
                }
                break;

            case TagState.InnerAntennaOutbound:
                if (elapsedTime > NullTransitionTimeout) {
                    console.warn(`${(new Date()).toISOString()}: state change: ${tagId}: InnerAntennaOutbound => <null>`);
                    this.tags.delete(tagId);
                }
                break;

            case TagState.InPending:
                if (elapsedTime > InboundTransitionTimeout) {
                    console.warn(`${(new Date()).toISOString()}: Ingress: ${tagId}`);
                    pendingHostEvents.push(this.buildBoatMessage(tagId, false, tagRecord.doorName));
                    this.tags.delete(tagId);
                }
                break;

            case TagState.OuterAntennaInbound:
                if (elapsedTime > NullTransitionTimeout) {
                    console.warn(`${(new Date()).toISOString()}: state change: ${tagId}: OuterAntennaInbound => <null>`);
                    this.tags.delete(tagId);
                }
                break;

            case TagState.OuterAntennaOutbound:
                if (elapsedTime > NullTransitionTimeout) {
                    // make sure we were seen by the outer antenna a few times or it could be noise
                    if (tagRecord.readsByOuterAntenna >= MinimumOuterReadCount) {
                        tagRecord.state = TagState.OutPending;
                        tagRecord.lastUpdate = now;
                        console.warn(`${(new Date()).toISOString()}: state change: ${tagId}: OuterAntennaOutbound => OutPending`);
                    } else {
                        console.warn(`${(new Date()).toISOString()}: state change: ${tagId}: OuterAntennaOutbound => <null> (noise)`);
                        this.tags.delete(tagId);
                    }
                }
                break;

            case TagState.OutPending:
                if (elapsedTime > OutboundTransitionTimeout) {
                    console.warn(`${(new Date()).toISOString()}: Egress:  ${tagId}`);
                    pendingHostEvents.push(this.buildBoatMessage(tagId, true, tagRecord.doorName));
                    this.tags.delete(tagId);
                }
        }
    }

    /** Queue an outgoing message to the BoatTracker service */
    private buildBoatMessage(tagId: string, isEgress: boolean, doorName: string): IHostEvent {
        return {
            EPC: tagId,
            ReadTime: (new Date()).toISOString(),
            Direction: isEgress ? "OUT" : "IN",
            Location: this.config.clubId,
            ReadZone: doorName
        };
    }

    /** Send pending messages to the server and clear the pending queue */
    private sendBoatMessages(messages: IHostEvent[], retryCount: number = 0): void {
        if (messages.length > 0 && retryCount < 5) {
            request({
                url: this.config.hostUrl + "/api/rfid/events",
                headers: {
                    "Authorization": `basic ${this.config.clubId}:${this.config.rfidPassword}`,
                },
                method: "POST",
                body: JSON.stringify(messages)
            }, (error: any, response: request.RequestResponse, body: any): void => {
                if (response.statusCode !== 200) {
                    console.error(`${(new Date()).toISOString()}: Delivery to cloud service failed (status=${response.statusCode}) -- will retry`);
                    console.error(`body = ${response.body}`);
                    this.sendBoatMessages(messages, retryCount + 1);
                }
            });
        }
    }
}