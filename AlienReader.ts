import * as net from "net";
import { RfidReader } from "./RfidReader";
import { IConfig, IReaderConfig } from "./ConfigManager";
import { Notification, NotificationManager } from "./NotificationManager";

enum State {
    Disconnected,
    ConnectedNeedUsernamePrompt,
    ConnectedNeedPasswordPrompt,
    ConnectedNeedFirstCmdPrompt,
    ConnectedAndSignedIn,
    WaitingForResponse
}

export class AlienReader extends RfidReader {
    private static DefaultHost: string = "localhost";
    private static DefaultPort: number = 20000;
    private static DefaultUser: string = "alien";
    private static DefaultPassword: string = "password";

    // todo: this won't work for multiple Alien readers
    private static NotifyPort: number = 20001;

    public constructor(config: IConfig, readerConfig: IReaderConfig) {
        super(config, readerConfig);

        this.client = new net.Socket();
        this.state = State.Disconnected;

        this.client.on("connect", () => this.onConnect());
        this.client.on("data", (buffer: Buffer) => this.onData(buffer));
        this.client.on("error", (error) => this.onError(error));

        this.outputBuffer = [];
        this.successCallback = null;
        this.failureCallback = null;

        this.notifMgr = new NotificationManager(this.config, this.readerConfig);
    }

    private notifMgr: NotificationManager;

    private client: net.Socket;
    private state: State;

    private outputBuffer: string[];
    private successCallback: null | ((value: any) => void);
    private failureCallback: null | ((error: Error) => void);

    private responseBuffer: string = "";

    private server: net.Server;
    //private notificationCounter: number = 0;

    private onConnect(): void {
        this.state = State.ConnectedNeedUsernamePrompt;
    }

    private onData(buffer: Buffer): void {
        this.responseBuffer += buffer.toString();

        switch (this.state) {
            case State.ConnectedNeedUsernamePrompt:
                if (this.responseBuffer.includes("Username>")) {
                    this.state = State.ConnectedNeedPasswordPrompt;
                    this.responseBuffer = "";
                    this.client.write((this.readerConfig.username || AlienReader.DefaultUser) + "\n");
                }
                break;

            case State.ConnectedNeedPasswordPrompt:
                if (this.responseBuffer.includes("Password>")) {
                    this.state = State.ConnectedNeedFirstCmdPrompt;
                    this.responseBuffer = "";
                    this.client.write((this.readerConfig.password || AlienReader.DefaultPassword) + "\n");
                }
                break;

            case State.ConnectedNeedFirstCmdPrompt:
                if (this.responseBuffer.includes("Alien>")) {
                    this.responseBuffer = "";
                    this.onCommandComplete();
                }
                break;

            case State.ConnectedAndSignedIn:
                this.addToBuffer(this.responseBuffer);
                this.responseBuffer = "";
                break;

            case State.WaitingForResponse:
                if (this.responseBuffer.includes("Alien>")) {
                    this.addToBuffer(this.responseBuffer);
                    this.responseBuffer = "";
                    this.onCommandComplete();
                }
                break;
        }
    }

    private onError(error: Error): void {
        console.error(`${(new Date()).toISOString()}: error: ${error.name} / ${error.message}`);
        if (this.failureCallback !== null) {
            this.failureCallback(error);
            this.failureCallback = null;
        }
    }

    private addToBuffer(data: string): void {
        const pattern: RegExp = /\r/g;
        const lines: string[] = data.replace(pattern, "").split("\n");
        for (const line of lines) {
            this.outputBuffer.push(line);
        }
    }

    private onCommandComplete(): void {
        this.state = State.ConnectedAndSignedIn;
        var output: string[] = this.outputBuffer.slice(1, this.outputBuffer.length - 2);

        if (this.successCallback !== null) {
            // only return the actual output from the command
            this.successCallback(output);
            this.successCallback = null;
        }
    }

    private async ConnectAndSignIn(): Promise<void> {
        if (this.state !== State.Disconnected) {
            throw "AlienReader: already connected";
        }

        return new Promise<void>((resolve, reject) => {
            this.successCallback = resolve;
            this.failureCallback = reject;

            // this starts the process that will take us through connection
            // and sign-in, and eventually call one of the callbacks.
            this.client.connect(
                this.readerConfig.port || AlienReader.DefaultPort,
                this.readerConfig.address || AlienReader.DefaultHost);
        });
    }

    private async RunCommand(cmd: string): Promise<void> {
        if (this.state !== State.ConnectedAndSignedIn) {
            throw "AlienReader: must be connected to call RunCommand";
        }

        return new Promise<void>((resolve, reject) => {
            this.successCallback = resolve;
            this.failureCallback = reject;

            this.outputBuffer = [];
            this.state = State.WaitingForResponse;
            this.client.write(cmd + "\r\n");
        });
    }

    private setupCmds: string[] = [
        "AcquireMode=Inventory",
        "TagListAntennaCombine=off",
        "NotifyMode=on",
        "NotifyTrigger=TrueFalse",
        "TagListCustomFormat=${TIME2},%N,%A,%k,%m",
        "NotifyFormat=Custom",
        "AutoModeReset",
        "AutoStopTimer=500",
        "AutoAction=Acquire",
        "AutoStartTrigger=0 0",
        "AutoStartPause=0",
        "AutoMode=on"       // should be last
    ];

    private async RunSetup(): Promise<void> {
        let output: any;

        try {
            console.warn("Initializing reader...");
            await this.ConnectAndSignIn();
            // send the variable commands
            output = await this.RunCommand(`ReaderName=${this.readerConfig.name}`);
            output = await this.RunCommand(`AntennaSequence=${this.readerConfig.antennas.join(" ")}`);
            output = await this.RunCommand(`NotifyAddress=${this.client.localAddress}:${AlienReader.NotifyPort}`);

            // send the fixed commands
            for (const command of this.setupCmds) {
                output = await this.RunCommand(command);
            }

            console.warn("Initialization complete!");
        } catch (error) {
            console.error("Setup error");
            throw error;
        }
    }

    public async StartReader(): Promise<void> {
        await this.RunSetup();

        this.server = net.createServer((socket: net.Socket) => {
            socket.on("connect", () => console.warn("Reader connected"));
            socket.on("end", () => console.warn("Reader disconnected"));
            socket.on("error", (error:Error) => {
                console.error(`${(new Date()).toISOString()}: Incoming connection error: ${error.name}/'${error.message}'`);
            });

            socket.on("data", (data: Buffer) => {
                //this.notificationCounter++;
                //if ((this.notificationCounter % 10) === 0) { process.stdout.write("."); }
                //if ((this.notificationCounter % 800) === 0) { process.stdout.write(".\r\n"); }

                const notification: string = data.toString();

                const pattern: RegExp = /\r/g;
                const lines: string[] = notification.replace(pattern, "").split("\n");
                let notifications: string[] = [];
                for (const line of lines) {
                    if (!line.startsWith("#") &&
                        !line.includes("#Alien") &&
                        !line.includes("No Tags") &&
                        line.length > 3) {
                        // queue the notification for processing
                        notifications.push(line);
                    }
                }

                // the notifications list may be empty. we still need to call the notification
                // manager so it can process any pending timeouts.
                this.dispatchNotifications(notifications);
            });
        });

        this.server.on("error", (error: Error) => {
            console.error(`Notification server error: ${error.name}/'${error.message}'`);
        });

        this.server.listen(AlienReader.NotifyPort, () => console.warn("Notification server listening..."));
    }

    /**
     * Process raw notifications from the reader and send a digested list to the
     * NotificationManager for processing.
     * @param rawNotifications Notifications as received from the reader
     */
    private dispatchNotifications(rawNotifications: string[]): void {
        let notifications: Notification[] = [];
        for (const rawNotification of rawNotifications) {
            const fields: string[] = rawNotification.split(",");

            if (fields.length === 5) {
                notifications.push(new Notification(
                    this.readerConfig,
                    fields[3],
                    Number(fields[2]),
                    Number(fields[4])
                ));
            }
        }

        // todo: look for multiple reads of the same tag and select the antenna
        // with the highest rssi for the tag.

        this.notifMgr.processNotifications(notifications);
    }
    
    public StopReader():void {
        this.server.close();
        this.client.destroy();
    }
}