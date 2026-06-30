import { Contract } from "./contract.js"

export class Team {
  constructor(private name: string, private contracts: Contract[] = []) {}

  calcCapUsed(): number {
    let sum: number = 0;

    for(let contract of this.contracts) {
      sum += contract.salaryCents;
    }

    return sum;
  }
}
