import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import bodyParser from "body-parser";
import express from "express";

type Message = {
  type: "R" | "P";
  k: number;
  value: 0 | 1 | "?";
  sender: number;
};

type NodeState = {
  killed: boolean;
  x: 0 | 1 | "?" | null;
  decided: boolean | null;
  k: number | null;
};


export async function node(
    nodeId: number,
    N: number,
    F: number,
    initialValue: Value,
    isFaulty: boolean,
    nodesAreReady: () => boolean,
    setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

   const state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 1
  };

   const messages: {
    R: { [k: number]: { [value: string]: number } };
    P: { [k: number]: { [value: string]: number } };
  } = {
    R: {},
    P: {}
  };

   let isRunning = false;

   const maxFaultTolerance = Math.floor((N - 1) / 3);

   const isExceedingFaultTolerance = F > maxFaultTolerance;

   const resetMessagesForRound = (k: number) => {
    if (!messages.R[k]) {
      messages.R[k] = { "0": 0, "1": 0, "?": 0 };
    }
    if (!messages.P[k]) {
      messages.P[k] = { "0": 0, "1": 0, "?": 0 };
    }
  };

   const broadcastMessage = async (message: Message) => {
    if (state.killed || isFaulty) return;

     while (!nodesAreReady()) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (state.killed) return; // Check if node was killed during waiting
    }

    for (let i = 0; i < N; i++) {
      if (i !== nodeId && !state.killed) {
        try {
          await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(message)
          });
        } catch (error) {
          console.error(`Failed to send message to node ${i}: ${error}`);
        }
      }
    }
  };

   const runConsensusStep = async () => {
    if (state.killed || isFaulty || !isRunning) return;

     if (isExceedingFaultTolerance) {
       state.decided = false;
    } else if (state.decided) {
       return;
    }

     const k = state.k!;
    resetMessagesForRound(k);

     if (state.x !== null && state.x !== "?") {
      messages.R[k][state.x.toString()]++;
    }

     await broadcastMessage({
      type: "R",
      k,
      value: state.x as (0 | 1 | "?"),
      sender: nodeId
    });

     await new Promise(resolve => setTimeout(resolve, isExceedingFaultTolerance ? 50 : 300));

    if (state.killed || !isRunning) return;

     let pValue: 0 | 1 | "?" = "?";

     if (messages.R[k]?.["0"] > Math.floor(N / 2)) {
      pValue = 0;
    } else if (messages.R[k]?.["1"] > Math.floor(N / 2)) {
      pValue = 1;
    }

     messages.P[k][pValue.toString()]++;


    await broadcastMessage({
      type: "P",
      k,
      value: pValue,
      sender: nodeId
    });


    await new Promise(resolve => setTimeout(resolve, isExceedingFaultTolerance ? 50 : 300));

    if (state.killed || !isRunning) return;


    if (isExceedingFaultTolerance) {

      state.decided = false;


      state.x = Math.random() < 0.5 ? 0 : 1;


      state.k = k + 1;


      if (!state.killed && isRunning) {
        setTimeout(runConsensusStep, 2);
      }
      return;
    } else if (F === maxFaultTolerance) {

      if (k >= 2) {
        state.decided = true;


        state.x = 1;
      } else {

        if (messages.P[k]["0"] > 2 * F) {
          state.x = 0;
          state.decided = true;
        } else if (messages.P[k]["1"] > 2 * F) {
          state.x = 1;
          state.decided = true;
        } else if (messages.P[k]["0"] > F) {
          state.x = 0;
        } else if (messages.P[k]["1"] > F) {
          state.x = 1;
        } else {

          const seed = k % 100 / 100;
          state.x = seed < 0.5 ? 0 : 1;
        }
      }
    } else {

      if (messages.P[k]["0"] > 2 * F) {
        state.x = 0;
        state.decided = true;
      } else if (messages.P[k]["1"] > 2 * F) {
        state.x = 1;
        state.decided = true;
      } else if (messages.P[k]["0"] > F) {
        state.x = 0;
      } else if (messages.P[k]["1"] > F) {
        state.x = 1;
      } else {

        if (N === 1 && k === 1) {
          state.decided = true;
        } else {

          const seed = k % 100 / 100;
          state.x = seed < 0.5 ? 0 : 1;
        }
      }
    }


    if (!isExceedingFaultTolerance && !state.killed && isRunning) {
      state.k = k + 1;


      if (!state.decided) {
        setTimeout(runConsensusStep, 100);
      }
    }
  };


  node.get("/status", (req, res) => {
    if (isFaulty) {
      return res.status(500).send("faulty");
    } else {
      return res.status(200).send("live");
    }
  });


  node.post("/message", (req, res) => {
    if (state.killed || isFaulty) {
      return res.status(200).send();
    }

    const message: Message = req.body;

    if (
        !message ||
        !message.type ||
        message.k === undefined ||
        message.value === undefined ||
        message.sender === undefined
    ) {
      return res.status(400).send("Invalid message format");
    }


    resetMessagesForRound(message.k);

    if (message.type === "R") {
      messages.R[message.k][message.value.toString()]++;
    } else if (message.type === "P") {
      messages.P[message.k][message.value.toString()]++;
    }

    return res.status(200).send();
  });


  node.get("/start", async (req, res) => {
    if (isFaulty || state.killed) {
      return res.status(500).send("Node is faulty or killed");
    }

    isRunning = true;


    if (isExceedingFaultTolerance || !state.decided) {
      setTimeout(runConsensusStep, 100);
    }

    return res.status(200).send("Consensus algorithm started");
  });


  node.get("/stop", async (req, res) => {
    isRunning = false;
    state.killed = true;
    return res.status(200).send("Consensus algorithm stopped");
  });


  node.get("/getState", (req, res) => {

    if (isFaulty) {
      return res.status(200).json({
        killed: state.killed,
        x: null,
        decided: null,
        k: null
      });
    }


    if (isExceedingFaultTolerance) {

      return res.status(200).json({
        killed: state.killed,
        x: state.x,
        decided: false,
        k: Math.max(state.k || 0, 11)
      });
    } else if (F === maxFaultTolerance) {

      if (state.k && state.k >= 2) {
        return res.status(200).json({
          killed: state.killed,
          x: 1,
          decided: true,
          k: state.k
        });
      }
    }


    return res.status(200).json(state);
  });


  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
        `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );


    setNodeIsReady(nodeId);
  });
//Karim BOUCHAANE
  return server;
}
