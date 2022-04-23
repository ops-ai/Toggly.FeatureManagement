using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Storage.EntityFramework;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    public class EntityFrameworkFeatureSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly IOptions<TogglySnapshotSettings> _snapshotSettings;
        private readonly TogglyEntities _entities;

        public EntityFrameworkFeatureSnapshotProvider(TogglyEntities entities, IOptions<TogglySnapshotSettings> snapshotSettings)
        {
            _entities = entities;
            _snapshotSettings = snapshotSettings;
        }

        public async Task<List<FeatureDefinitionModel>?> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            var existingFeatures = await _entities.TogglyFeatures.Include(t => t.Filters).ThenInclude(t => t.Parameters).ToListAsync(ct);

            return existingFeatures.Select(t => new FeatureDefinitionModel
            {
                FeatureKey = t.FeatureKey,
                Filters = t.Filters.Select(f => new Data.FeatureFilter { Name = f.Name, Parameters = f.Parameters.ToDictionary(p => p.Name, p => p.Value) }).ToList()
            }).ToList();
        }

        public async Task SaveSnapshotAsync(List<FeatureDefinitionModel> features, CancellationToken ct = default)
        {
            var existingFeatures = await _entities.TogglyFeatures.Include(t => t.Filters).ThenInclude(t => t.Parameters).ToListAsync(ct);

            if (!existingFeatures.Any())
            {
                foreach (var feature in features)
                {
                    await _entities.TogglyFeatures.AddAsync(new Feature { 
                        FeatureKey = feature.FeatureKey, 
                        Filters = feature.Filters.Select(f => new EntityFramework.FeatureFilter { 
                            Name = f.Name, 
                            Parameters = f.Parameters.Select(p => new FeatureFilterParameter { Name = p.Key, Value = p.Value }).ToList()
                        }).ToList()
                    }, ct);
                }

                await _entities.SaveChangesAsync(ct);
            }
            else
            {
                foreach (var feature in features)
                {
                    var existingFeatureEnt = existingFeatures.FirstOrDefault(t => t.FeatureKey == feature.FeatureKey);
                    if (existingFeatureEnt != null)
                    {
                        foreach (var filter in feature.Filters)
                        {
                            var existingFilter = existingFeatureEnt.Filters.FirstOrDefault(f => f.Name == filter.Name);
                            if (existingFilter != null)
                                foreach (var param in filter.Parameters)
                                {
                                    var existingParam = existingFilter.Parameters.FirstOrDefault(t => t.Name == param.Key);
                                    if (existingParam != null)
                                        existingParam.Value = param.Value;
                                    else
                                        existingFilter.Parameters.Add(new FeatureFilterParameter {  Name = param.Key, Value = param.Value });
                                }
                            else
                                existingFeatureEnt.Filters.Add(new EntityFramework.FeatureFilter { Name = filter.Name, Parameters = filter.Parameters.Select(p => new FeatureFilterParameter { Name = p.Key, Value = p.Value }).ToList() });
                        }
                        //TODO: Remove old values
                    }
                    else
                        await _entities.TogglyFeatures.AddAsync(new Feature
                        {
                            FeatureKey = feature.FeatureKey,
                            Filters = feature.Filters.Select(f => new EntityFramework.FeatureFilter
                            {
                                Name = f.Name,
                                Parameters = f.Parameters.Select(p => new FeatureFilterParameter { Name = p.Key, Value = p.Value }).ToList()
                            }).ToList()
                        }, ct);
                }
                await _entities.SaveChangesAsync(ct);
            }
        }
    }
}