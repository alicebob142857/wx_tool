import path from "node:path";
import { buildStaticHistory } from "../src/static-history.js";

const rootDir = path.resolve(process.cwd());
const history = await buildStaticHistory(rootDir);
console.log(`静态历史已生成：${history.total} 个岗位`);
