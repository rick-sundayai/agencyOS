-- Custom SQL migration file, put your code below! --
CREATE INDEX embeddings_embedding_hnsw
  ON embeddings USING hnsw (embedding halfvec_cosine_ops);