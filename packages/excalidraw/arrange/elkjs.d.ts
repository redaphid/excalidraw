/** elkjs types its API and bundled builds but not the worker build, which is imported only for its side effect of installing ELK's message dispatcher */
declare module "elkjs/lib/elk-worker.min.js" {}
