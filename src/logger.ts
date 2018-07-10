import { View } from "vega-lib";
import { throttle } from "./util";

interface Record {
  view: string;
  name: string;
  timestamp?: number;
  brushStart?: number;
  brushEnd?: number;
  pixBrushStart?: number;
  pixBrushEnd?: number;
}

interface MouseRecord {
  name: string;
  timestamp: number;
  pageX: number;
  pageY: number;
}

export class Logger<V extends string> {
  private static maxtries = 3; // maximum # of tries to send things to server
  private logContainer: Record[] = [];
  private stagingContainer: Record[] = [];

  private mouseLogContainer: MouseRecord[] = [];
  private stagingMouseContainer: MouseRecord[] = [];
  private intervalHandler;

  /**
   * Constructs the logger
   */
  constructor(
    private userid?: string,
    private taskid?: string,
    private logUrl?: string,
    private logFields?: string[],
    private mouseLogFields?: string[]
  ) {
    document.onmousemove = throttle(this.trackMouse.bind(this), 50);
    this.intervalHandler = setInterval(this.flush.bind(this), 10000);

    this.logFields = [
      "view",
      "name",
      "timestamp",
      "brushStart",
      "brushEnd",
      "pixBrushStart",
      "pixBrushEnd"
    ];
    this.mouseLogFields = ["name", "timestamp", "pageX", "pageY"];
  }

  /*
  * track global mouse position
  */
  private trackMouse(event) {
    this.appendToMouseLog({
      timestamp: Date.now(),
      name: "mouse",
      pageX: event.pageX,
      pageY: event.pageY
    });
  }

  /**
   * Attach logging to the Vega view.
   */
  public attach(name: V, view: View) {
    console.log(view["_spec"]);
    console.log(view.origin(), view.width(), view.height(), view.container());

    view.addEventListener("mouseenter", _ => {
      this.appendToLog({
        view: name,
        name: "mouseenter"
      });
    });

    view.addEventListener("mouseleave", _ => {
      this.appendToLog({
        view: name,
        name: "mouseleave"
      });
    });

    view.addSignalListener("brushMouse", (_, value) => {
      if (value > 0) {
        // filter events that are in the wrong chart
        const brushRange = view.signal("brush");
        const pixBrushRange = view.signal("pixelBrush");
        this.appendToLog({
          view: name,
          name: value === 2 ? "brushStart" : "brushEnd",
          brushStart: brushRange[0],
          brushEnd: brushRange[1],
          pixBrushStart: pixBrushRange[0],
          pixBrushEnd: pixBrushRange[1]
        });
      }
    });

    view.addSignalListener("brush", (_, brushRange) => {
      const pixBrushRange = view.signal("pixelBrush");
      this.appendToLog({
        view: name,
        name: "brush",
        brushStart: brushRange[0],
        brushEnd: brushRange[1],
        pixBrushStart: pixBrushRange[0],
        pixBrushEnd: pixBrushRange[1]
      });
    });
  }

  /**
   * returns whether the logger has not flushed all logs yet.
   */
  public hasUnsentData(): boolean {
    this.flush(); // try flushing
    return (
      this.logContainer.length +
        this.mouseLogContainer.length +
        this.stagingContainer.length +
        this.stagingMouseContainer.length >
      0
    );
  }

  private appendToLog(record: Record) {
    record.timestamp = Date.now();
    this.logContainer.push(record);
  }

  private appendToMouseLog(record: MouseRecord) {
    record.timestamp = Date.now();
    this.mouseLogContainer.push(record);
  }

  private flush() {
    // abort if the we are sending stuff right now
    if (
      this.stagingContainer.length + this.stagingMouseContainer.length !==
      0
    ) {
      console.log(
        "Cannot send new logs because we are in the process of sending some data."
      );
      return;
    }

    //move from log container to staging container
    this.stagingContainer = this.logContainer;
    this.stagingMouseContainer = this.mouseLogContainer;

    const logLength =
      this.stagingContainer.length + this.stagingMouseContainer.length;
    if (logLength === 0) {
      // no need to send anything
      return;
    }

    console.log(`Sending ${logLength} log entries.`);
    // send contents to server
    let tries = 0;
    const doSend = () => {
      fetch(this.logUrl, {
        body: JSON.stringify({
          userid: this.userid,
          taskid: this.taskid,
          log: this.stagingContainer,
          logFields: this.logFields,
          mouseLog: this.stagingMouseContainer,
          mouseLogFields: this.mouseLogFields
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
        .then(response => {
          if (response.ok) {
            this.stagingContainer = [];
            this.stagingMouseContainer = [];
          } else {
            tries++;
            if (tries < Logger.maxtries) {
              console.log(
                `Sending logs failed. Trying again (${tries}/${
                  Logger.maxtries
                }).`
              );
              doSend();
            } else {
              clearInterval(this.intervalHandler);
              throw "Reached maximum limit of resends: " + response.statusText;
            }
          }
        })
        .catch(error => {
          clearInterval(this.intervalHandler);
          throw error;
        });
    };
    doSend();
  }
}
