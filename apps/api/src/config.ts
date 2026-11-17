import { z } from "zod";

export const startingBalanceCents = () => z.coerce.number().int().positive().max(2_147_483_647)
  .parse(process.env.STARTING_BALANCE_CENTS ?? "1000");
