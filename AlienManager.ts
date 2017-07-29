import * as net from 'net';
import { IReaderConfig } from "./ConfigManager";

enum State {
    Disconnected,
    ConnectedNeedUsernamePrompt,
    ConnectedNeedPasswordPrompt,
    ConnectedNeedFirstCmdPrompt,
    ConnectedAndSignedIn,
    WaitingForResponse
}

export class AlienManager {
    private static DefaultHost: string = "localhost";
    private static DefaultPort: number = 20000;
    private static DefaultUser: string = "alien";
    private static DefaultPassword: string = "password";

    public constructor(readerConfig: IReaderConfig) {
        this.readerConfig = readerConfig;

        this.socket = new net.Socket();
        this.state = State.Disconnected;

        this.socket.on("connect", () => this.onConnect());
        this.socket.on("data", (buffer: Buffer) => this.onData(buffer));
        this.socket.on("error", (error) => this.onError(error));

        this.outputBuffer = [];
        this.successCallback = null;
        this.failureCallback = null;
    }

    private readerConfig: IReaderConfig;

    private socket: net.Socket;
    private state: State;

    private outputBuffer: string[];
    private successCallback: null | ((value: any) => void);
    private failureCallback: null | ((error: Error) => void);

    private onConnect() {
        console.warn("connected");
        this.state = State.ConnectedNeedUsernamePrompt;
    }

    private onData(buffer: Buffer) {
        const data: string = buffer.toString();

        console.warn(`onData: received = "${data}`);
        switch (this.state) {
            case State.ConnectedNeedUsernamePrompt:
                if (data.includes("Username>")) {
                    this.state = State.ConnectedNeedPasswordPrompt;
                    this.socket.write((this.readerConfig.username || AlienManager.DefaultUser) + "\n");
                } else {
                    throw "onData: expected username prompt";
                }
                break;

            case State.ConnectedNeedPasswordPrompt:
                if (data.includes("Password>")) {
                    this.state = State.ConnectedNeedFirstCmdPrompt;
                    this.socket.write((this.readerConfig.password || AlienManager.DefaultPassword) + "\n");
                } else {
                    throw "onData: expected password prompt";
                }
                break;

            case State.ConnectedNeedFirstCmdPrompt:
                if (data.includes("Alien >")) {
                    this.onCommandComplete();
                }

            case State.ConnectedAndSignedIn:
                this.addToBuffer(data);
                break;

            case State.WaitingForResponse:
                this.addToBuffer(data);
                if (data.includes("Alien >")) {
                    this.onCommandComplete();
                }
                break;
        }
    }

    private addToBuffer(data: string) {
        const pattern = /\r/g;
        const lines: string[] = data.replace(pattern, "").split("\n");
        for (const line of lines) {
            this.outputBuffer.push(line);
        }
    }

    private onError(error: Error) {
        console.error(`error: ${error.name} / ${error.message}`);
        if (this.failureCallback !== null) {
            this.failureCallback(error);
            this.failureCallback = null;
        }
    }

    private onCommandComplete() {
        this.state = State.ConnectedAndSignedIn;
        var output = this.outputBuffer.slice(1, this.outputBuffer.length - 2);

        if (this.successCallback !== null) {
            // only return the actual output from the command
            this.successCallback(output);
            this.successCallback = null;
        }
    }

    public async ConnectAndSignIn(): Promise<void> {
        if (this.state != State.Disconnected) {
            throw "AlienManager: already connected";
        }

        return new Promise<void>((resolve, reject) => {
            this.successCallback = resolve;
            this.failureCallback = reject;

            // this starts the process that will take us through connection
            // and sign-in, and eventually call one of the callbacks.
            this.socket.connect(
                this.readerConfig.port || AlienManager.DefaultPort,
                this.readerConfig.address || AlienManager.DefaultHost);
        });
    }

    public async RunCommand(cmd: string): Promise<void> {
        if (this.state != State.ConnectedAndSignedIn) {
            throw "AlienManager: must be connected to call RunCommand";
        }

        return new Promise<void>((resolve, reject) => {
            this.successCallback = resolve;
            this.failureCallback = reject;

            this.outputBuffer = [];
            this.state = State.WaitingForResponse;
            this.socket.write(cmd + "\r");
        });
    }

    private setupCmds: string[] = [
        "SetTagListCustomFormat=%N,%A,%k,%m",
        "SetAcquireMode=Inventory",
        //"SetTagListAntennaCombine=off",
        "SetNotifyMode=on",
        "SetNotifyTrigger=TrueFalse",
        "SetNotifyFormat=Custom",
        //"AutoModeReset",
        "SetAutoStopTimer=1000",
        "SetAutoAction=Acquire",
        //"SetAutoStartTrigger=0 0",
        "SetAutoStartPause=0",
        "SetAutoMode=on"       // should be last
    ]

    public async RunSetup(): Promise<void> {
        let output: any;

        try {
            await this.ConnectAndSignIn();
            // Send the variable commands
            output = await this.RunCommand(`SetReaderName=${this.readerConfig.name}`);
            output = await this.RunCommand(`SetAntennaSequence=${this.readerConfig.antennas.join(" ")}`);
            output = await this.RunCommand(`SetNotifyAddress=${this.socket.localAddress}:20001`);

            // Send the fixed commands
            for (const command of this.setupCmds) {
                output = await this.RunCommand(command);
            }

        } catch (error) {
            console.error("Setup error");
        }
    }
}
