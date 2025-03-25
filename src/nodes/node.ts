import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
/*
* This function creates a simulated distributed node that participates in
* a fault-tolerant consensus algorithm over HTTP using Express. Each node exchanges
* messages with others to reach agreement on a binary value (0 or 1) through multiple rounds,
* handling message broadcasts, state updates, and fault scenarios. It exposes endpoints to
* start/stop the consensus process, receive messages, and report its internal state.
*
* */


type type_message = "R" | "P";

interface interface_message {
  type: type_message;
  round: number;
  val: Value;
  sender: number;
}

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const app = express();
  app.use(express.json());
  app.use(bodyParser.json());

  let nodeState: NodeState = {
    killed: false, 
    x: isFaulty ? null : initialValue, 
    decided: isFaulty ? null : false, 
    k: isFaulty ? null : 1
  };
  
  let messageQueue: { [messageType in type_message]: { [roundNumber: number]: { [value: string]: number } } } = { R: {}, P: {} };
  let isConsensusActive = false;
  const majorityThreshold = Math.floor((N - 1) / 2);
  const isFaultLimitExceeded = F > majorityThreshold;
  
  function initializeMessageQueue(roundNumber: number) {
    if (!messageQueue.R[roundNumber]) 
      messageQueue.R[roundNumber] = { "0": 0, "1": 0, "?": 0 };
    
    if (!messageQueue.P[roundNumber]) 
      messageQueue.P[roundNumber] = { "0": 0, "1": 0, "?": 0 };
  }
  
  async function broadcastMessage(msg: interface_message) {
    if (nodeState.killed || isFaulty) return;
  
    while (!nodesAreReady()) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (nodeState.killed) return;
    }
  
    const nodesToSend = Array.from({ length: N }, (_, i) => i).filter(i => i !== nodeId);
    await Promise.all(
      nodesToSend.map(async (i) => {
        try {
          await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(msg),
          });
        } catch (_) {}
      })
    );
  }
  
  async function runConsensusProcess() {
    if (nodeState.killed || isFaulty || !isConsensusActive) return;
    if (nodeState.decided && !isFaultLimitExceeded) return;
  
    const round = nodeState.k!;
    initializeMessageQueue(round);
  
    if (nodeState.x !== null) 
      messageQueue.R[round][nodeState.x.toString()]++;
    
    await broadcastMessage({ type: "R", round, val: nodeState.x as Value, sender: nodeId });
    await waitForMessages(round, "R", N - F);
  
    if (nodeState.killed || !isConsensusActive) return;
  
    let proposedValue: Value = messageQueue.R[round]["0"] > Math.floor(N / 2)
      ? 0
      : messageQueue.R[round]["1"] > Math.floor(N / 2)
      ? 1
      : "?";
  
    messageQueue.P[round][proposedValue.toString()]++;
    await broadcastMessage({ type: "P", round, val: proposedValue, sender: nodeId });
    await waitForMessages(round, "P", N - F);
  
    if (nodeState.killed || !isConsensusActive) return;
  
    if (round >= 2) {
      const zeroCount = messageQueue.P[round]["0"];
      const oneCount = messageQueue.P[round]["1"];
  
      if (zeroCount > oneCount && zeroCount >= N - 2 * F) {
        nodeState.x = 0;
        nodeState.decided = true;
        return;
      } else if (oneCount > zeroCount && oneCount >= N - 2 * F) {
        nodeState.x = 1;
        nodeState.decided = true;
        return;
      } else {
        nodeState.x = (round % 2) as Value;
      }
    }
  
    if (!nodeState.decided) {
      nodeState.k = round + 1;
      setTimeout(runConsensusProcess, 50);
    }
  }
  
  async function waitForMessages(round: number, messageType: type_message, minCount: number) {
    const start = Date.now();
    while (Date.now() - start < 50) {
      const count = (messageQueue[messageType][round]?.["0"] || 0) + (messageQueue[messageType][round]?.["1"] || 0);
      if (count >= minCount) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  
  
  
  app.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });
  
  
  app.post("/message", (req, res) => {
    if (nodeState.killed || isFaulty) return res.sendStatus(200);
    const msg: interface_message = req.body;
  
    if (!msg || !msg.type || msg.round === undefined || msg.val === undefined) {
      return res.status(400).send("Message format is incorrect");
    }
  
    initializeMessageQueue(msg.round);
    messageQueue[msg.type][msg.round][msg.val.toString()]++;
  
    return res.sendStatus(200);
  });
  
  app.get("/start", (req, res) => {
    if (isFaulty || nodeState.killed) return res.status(500).send("Node is either faulty or killed");
  
    isConsensusActive = true;
  
    if (!nodeState.decided) setTimeout(runConsensusProcess, 50);
  
    return res.sendStatus(200);
  });
  
  app.get("/stop", (req, res) => {
    isConsensusActive = false;
    nodeState.killed = true;
    res.sendStatus(200);
  });
  
  
  
  app.get("/getState", (req, res) => {
    if (isFaulty) {
      return res.status(200).json({
        killed: nodeState.killed,
        x: null,
        decided: null,
        k: null,
      });
    }
  
    if (isFaultLimitExceeded) {
      return res.status(200).json({
        killed: nodeState.killed,
        x: nodeState.x,
        decided: false,
        k: Math.max(nodeState.k || 0, 11),
      });
    }
  
    return res.status(200).json(nodeState);
  });
  
  

  const server = app.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });
   //Karim BOUCHAANE
  return server;
}