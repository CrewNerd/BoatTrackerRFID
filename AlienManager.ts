import * as net from 'net';

enum State {
    Disconnected,
    ConnectedNeedUsernamePrompt,
    ConnectedNeedPasswordPrompt,
    ConnectedNeedFirstCmdPrompt,
    ConnectedAndSignedIn,
    WaitingForResponse
}

export class AlienManager {
    public constructor(
        host: string = "localhost",
        port: number = 20000,
        username: string = "alien",
        password: string = "password")
    {
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;

        this.socket = new net.Socket();
        this.state = State.Disconnected;

        this.socket.on("connect", () => this.onConnect());
        this.socket.on("data", (buffer: Buffer) => this.onData(buffer));
        this.socket.on("error", (error) => this.onError(error));

        this.outputBuffer = [];
        this.clientCallback = null;
    }

    private host: string;
    private port: number;
    private username: string;
    private password: string;

    private socket: net.Socket;
    private state: State;

    private outputBuffer: string[];
    private clientCallback: null | ((error: Error | null) => void);

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
                    this.socket.write(this.username + "\n");
                } else {
                    throw "onData: expected username prompt";
                }
                break;

            case State.ConnectedNeedPasswordPrompt:
                if (data.includes("Password>")) {
                    this.state = State.ConnectedNeedFirstCmdPrompt;
                    this.socket.write(this.password + "\n");
                } else {
                    throw "onData: expected password prompt";
                }
                break;

            case State.ConnectedNeedFirstCmdPrompt:
                if (data.includes("Alien >")) {
                    this.state = State.ConnectedAndSignedIn;
                    if (this.clientCallback !== null) {
                        this.clientCallback(null);
                    }
                }

            case State.ConnectedAndSignedIn:
                this.addToBuffer(data);
                break;

            case State.WaitingForResponse:
                this.addToBuffer(data);
                if (data.includes("\nAlien >")) {
                    this.onCommandComplete();
                }
                break;
        }

    }

    private addToBuffer(data: string) {
        const lines: string[] = data.split("\n");
        this.outputBuffer.push(data);
    }

    private onError(error: Error) {
        console.error(`error: ${error.name} / ${error.message}`);
        if (this.clientCallback !== null) {
            this.clientCallback(error);
            this.clientCallback = null;
        }
    }

    private onCommandComplete() {
        if (this.clientCallback !== null) {
            this.clientCallback(null);
            this.clientCallback = null;
        }
    }

    public Connect(onConnected: (error: Error | null) => void) {
        if (this.state != State.Disconnected) {
            throw "AlienManager: already connected";
        }

        this.clientCallback = onConnected;
        this.socket.connect(this.port, this.host);
    }

    public RunCommand(cmd: string, onComplete: (error: Error | null) => void) {
        if (this.state != State.ConnectedAndSignedIn) {
            throw "AlienManager: must be connected to call RunCommand";
        }

        this.outputBuffer = [];
        this.clientCallback = onComplete;
        this.state = State.WaitingForResponse;
        this.socket.write(cmd + "\r");
    }

    public GetOutput(): string[] {
        const output: string[] = this.outputBuffer;
        this.outputBuffer = [];
        return output;
    }
}
