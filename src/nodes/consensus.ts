import { BASE_NODE_PORT } from "../config";





/* This 2 function is to launch a nodes in
the port that in base node port variables */




export async function startConsensus(N: number) {
  for (let index = 0; index < N; index++) {
    await fetch(`http://localhost:${BASE_NODE_PORT + index}/start`);
  }
}






export async function stopConsensus(N: number) {
  for (let index = 0; index < N; index++) {
    await fetch(`http://localhost:${BASE_NODE_PORT + index}/stop`);
  }
}
