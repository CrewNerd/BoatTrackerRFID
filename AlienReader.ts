import * as net from "net";
import * as fs from "fs";
import { RfidReader } from "./RfidReader";
import { IConfig, IReaderConfig } from "./ConfigManager";
import { Notification, AntennaType, NotificationManager } from "./NotificationManager";

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

    private logFile: number;
    private notifMgr: NotificationManager;

    private client: net.Socket;
    private state: State;

    private outputBuffer: string[];
    private successCallback: null | ((value: any) => void);
    private failureCallback: null | ((error: Error) => void);

    private responseBuffer: string = "";

    private server: net.Server;
    private timer: NodeJS.Timer;

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
        // acquire parameters
        "AcquireMode=Inventory",
        "AcqG2Q=1",
        "AcqG2AntennaCombine=OFF",
        "AcqG2Session=0",
        "TagListAntennaCombine=off",

        // tag streaming setup
        "TagStreamFormat=Custom",
        "TagStreamCustomFormat=${TIME2},%N,%A,%k,%m",
        "TagStreamKeepAliveTime=60",
        "StreamHeader=OFF",
        "TagStreamMode=ON",
        "NotifyMode=off",

        // auto-mode set for continuous reading
        "AutoModeReset",
        "AutoStopTimer=0",
        "AutoAction=Acquire",
        "AutoStartTrigger=0 0",
        "AutoStartPause=0",
        "AutoMode=on"
    ];

    private async RunSetup(): Promise<void> {
        let output: any;

        try {
            console.warn("Initializing reader...");
            await this.ConnectAndSignIn();
            // send the variable commands
            output = await this.RunCommand(`ReaderName=${this.readerConfig.name}`);
            output = await this.RunCommand(`AntennaSequence=${this.readerConfig.antennas.join(" ")}`);
            output = await this.RunCommand(`TagStreamAddress=${this.client.localAddress}:${AlienReader.NotifyPort}`);

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
        this.logFile = fs.openSync("readlog.csv", "a");
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

                if (notifications.length > 0) {
                    this.dispatchNotifications(notifications);
                }
            });
        });

        this.server.on("error", (error: Error) => {
            console.error(`Notification server error: ${error.name}/'${error.message}'`);
        });

        this.server.listen(AlienReader.NotifyPort, () => console.warn("Notification server listening..."));

        this.timer = setInterval(() => this.notifMgr.processTimeouts(), 250);
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
                const tagId: string = fields[3];
                const antenna: number = Number(fields[2]);
                const rssi: number = Number(fields[4]);

                let notification:Notification = new Notification(this.readerConfig, tagId, antenna, rssi);
                notifications.push(notification);

                if (antenna === 0) {
                    fs.writeSync(this.logFile, `${(new Date()).toISOString()},${tagId},${rssi},\r\n`);
                } else {
                    fs.writeSync(this.logFile, `${(new Date()).toISOString()},${tagId},,${rssi}\r\n`);
                }
            }
        }

        this.notifMgr.processNotifications(notifications);
    }
    
    public StopReader():void {
        this.server.close();
        this.client.destroy();
        clearInterval(this.timer);
        fs.closeSync(this.logFile);
    }
}