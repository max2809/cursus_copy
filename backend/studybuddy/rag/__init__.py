"""RAG subsystem: parsing, chunking, embedding, reranking, downloading, indexing.

INDEX_VERSION: bump whenever chunker or embedder logic changes in a way
that invalidates existing chunks. The indexer reindexes any file with
files.index_version < INDEX_VERSION.
"""

INDEX_VERSION = 1
