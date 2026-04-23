-- Change AI starting CPU from 2 to 1 per updated spec.
-- At CPU 1 AIs produce no viruses until humans grant CPU 2+ via resource allocation,
-- making resource allocation strategically meaningful from turn 1.
ALTER TABLE players ALTER COLUMN cpu SET DEFAULT 1;
