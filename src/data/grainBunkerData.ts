export type CropId = 'wheat' | 'barley' | 'corn' | 'soybean' | 'sunflower' | 'mustard'

export type CombineDefinition = {
  id: string
  name: string
  volumeL: number
  custom?: boolean
}

export type GrainProfile = {
  id: string
  name: string
  density: number
}

export type CropDefinition = {
  name: string
  defaultProfile: string
  baseMoisture: number
  tolerance: number
  profiles: GrainProfile[]
}

export type YieldBenchmark = {
  min: number
  average: number
  max: number
  source: string
}

export const combines: CombineDefinition[] = [
  {
    "id": "case_9240",
    "name": "Case IH AFS 9240",
    "volumeL": 14448,
    "custom": false
  },
  {
    "id": "case_9250",
    "name": "Case IH AFS 9250",
    "volumeL": 14448,
    "custom": false
  },
  {
    "id": "jd_s680",
    "name": "John Deere S680",
    "volumeL": 14100,
    "custom": false
  },
  {
    "id": "jd_s790",
    "name": "John Deere S790",
    "volumeL": 14100,
    "custom": false
  },
  {
    "id": "custom",
    "name": "Custom volume",
    "volumeL": 14100,
    "custom": true
  }
]

export const crops: Record<CropId, CropDefinition> = {
  "wheat": {
    "name": "Wheat",
    "defaultProfile": "wheat_avg",
    "baseMoisture": 14.5,
    "tolerance": 0.05,
    "profiles": [
      {
        "id": "wheat_avg",
        "name": "Average wheat",
        "density": 772
      },
      {
        "id": "wheat_light",
        "name": "Light wheat",
        "density": 730
      },
      {
        "id": "wheat_below",
        "name": "Below-average wheat",
        "density": 745
      },
      {
        "id": "wheat_standard",
        "name": "Standard wheat",
        "density": 760
      },
      {
        "id": "wheat_dense",
        "name": "Dense wheat",
        "density": 785
      },
      {
        "id": "wheat_very_dense",
        "name": "Very dense wheat",
        "density": 805
      },
      {
        "id": "wheat_durum",
        "name": "Durum wheat",
        "density": 790
      },
      {
        "id": "wheat_soft",
        "name": "Soft wheat",
        "density": 755
      },
      {
        "id": "wheat_winter",
        "name": "Winter wheat",
        "density": 775
      },
      {
        "id": "wheat_spring",
        "name": "Spring wheat",
        "density": 765
      },
      {
        "id": "wheat_low_tw",
        "name": "Low test weight wheat",
        "density": 710
      },
      {
        "id": "wheat_high_tw",
        "name": "High test weight wheat",
        "density": 810
      },
      {
        "id": "wheat_feed",
        "name": "Feed wheat",
        "density": 720
      },
      {
        "id": "wheat_milling",
        "name": "Milling wheat",
        "density": 780
      },
      {
        "id": "wheat_clean",
        "name": "Clean wheat",
        "density": 795
      },
      {
        "id": "wheat_impurities",
        "name": "Wheat with impurities",
        "density": 735
      },
      {
        "id": "wheat_large",
        "name": "Large-kernel wheat",
        "density": 785
      },
      {
        "id": "wheat_small",
        "name": "Small-kernel wheat",
        "density": 750
      },
      {
        "id": "wheat_dry",
        "name": "Dry dense wheat",
        "density": 800
      },
      {
        "id": "wheat_harvest",
        "name": "Harvest average wheat",
        "density": 765
      }
    ]
  },
  "barley": {
    "name": "Barley",
    "defaultProfile": "barley_avg",
    "baseMoisture": 14,
    "tolerance": 0.06,
    "profiles": [
      {
        "id": "barley_avg",
        "name": "Average barley",
        "density": 618
      },
      {
        "id": "barley_light",
        "name": "Light barley",
        "density": 560
      },
      {
        "id": "barley_below",
        "name": "Below-average barley",
        "density": 585
      },
      {
        "id": "barley_standard",
        "name": "Standard barley",
        "density": 610
      },
      {
        "id": "barley_dense",
        "name": "Dense barley",
        "density": 640
      },
      {
        "id": "barley_very_dense",
        "name": "Very dense barley",
        "density": 670
      },
      {
        "id": "barley_malting",
        "name": "Malting barley",
        "density": 625
      },
      {
        "id": "barley_feed",
        "name": "Feed barley",
        "density": 600
      },
      {
        "id": "barley_winter",
        "name": "Winter barley",
        "density": 620
      },
      {
        "id": "barley_spring",
        "name": "Spring barley",
        "density": 605
      },
      {
        "id": "barley_low_tw",
        "name": "Low test weight barley",
        "density": 550
      },
      {
        "id": "barley_high_tw",
        "name": "High test weight barley",
        "density": 680
      },
      {
        "id": "barley_two_row",
        "name": "Two-row barley",
        "density": 635
      },
      {
        "id": "barley_six_row",
        "name": "Six-row barley",
        "density": 600
      },
      {
        "id": "barley_clean",
        "name": "Clean barley",
        "density": 650
      },
      {
        "id": "barley_impurities",
        "name": "Barley with impurities",
        "density": 575
      },
      {
        "id": "barley_large",
        "name": "Large-kernel barley",
        "density": 640
      },
      {
        "id": "barley_small",
        "name": "Small-kernel barley",
        "density": 590
      },
      {
        "id": "barley_dry",
        "name": "Dry dense barley",
        "density": 660
      },
      {
        "id": "barley_harvest",
        "name": "Harvest average barley",
        "density": 615
      }
    ]
  },
  "corn": {
    "name": "Corn",
    "defaultProfile": "corn_avg",
    "baseMoisture": 15.5,
    "tolerance": 0.06,
    "profiles": [
      {
        "id": "corn_avg",
        "name": "Average corn",
        "density": 721
      },
      {
        "id": "corn_light",
        "name": "Light corn",
        "density": 660
      },
      {
        "id": "corn_below",
        "name": "Below-average corn",
        "density": 690
      },
      {
        "id": "corn_standard",
        "name": "Standard corn",
        "density": 720
      },
      {
        "id": "corn_dense",
        "name": "Dense corn",
        "density": 750
      },
      {
        "id": "corn_very_dense",
        "name": "Very dense corn",
        "density": 780
      },
      {
        "id": "corn_dent",
        "name": "Dent corn",
        "density": 715
      },
      {
        "id": "corn_flint",
        "name": "Flint corn",
        "density": 760
      },
      {
        "id": "corn_feed",
        "name": "Feed corn",
        "density": 705
      },
      {
        "id": "corn_food",
        "name": "Food corn",
        "density": 730
      },
      {
        "id": "corn_low_tw",
        "name": "Low test weight corn",
        "density": 650
      },
      {
        "id": "corn_high_tw",
        "name": "High test weight corn",
        "density": 790
      },
      {
        "id": "corn_dry",
        "name": "Dry dense corn",
        "density": 770
      },
      {
        "id": "corn_harvest",
        "name": "Harvest average corn",
        "density": 710
      },
      {
        "id": "corn_large",
        "name": "Large-kernel corn",
        "density": 735
      },
      {
        "id": "corn_small",
        "name": "Small-kernel corn",
        "density": 700
      },
      {
        "id": "corn_clean",
        "name": "Clean corn",
        "density": 745
      },
      {
        "id": "corn_impurities",
        "name": "Corn with impurities",
        "density": 680
      },
      {
        "id": "corn_yellow",
        "name": "Yellow corn",
        "density": 720
      },
      {
        "id": "corn_white",
        "name": "White corn",
        "density": 725
      }
    ]
  },
  "soybean": {
    "name": "Soybean",
    "defaultProfile": "soy_avg",
    "baseMoisture": 13,
    "tolerance": 0.05,
    "profiles": [
      {
        "id": "soy_avg",
        "name": "Average soybean",
        "density": 772
      },
      {
        "id": "soy_light",
        "name": "Light soybean",
        "density": 700
      },
      {
        "id": "soy_below",
        "name": "Below-average soybean",
        "density": 730
      },
      {
        "id": "soy_standard",
        "name": "Standard soybean",
        "density": 760
      },
      {
        "id": "soy_dense",
        "name": "Dense soybean",
        "density": 790
      },
      {
        "id": "soy_very_dense",
        "name": "Very dense soybean",
        "density": 820
      },
      {
        "id": "soy_large",
        "name": "Large-seed soybean",
        "density": 765
      },
      {
        "id": "soy_small",
        "name": "Small-seed soybean",
        "density": 785
      },
      {
        "id": "soy_low_tw",
        "name": "Low test weight soybean",
        "density": 690
      },
      {
        "id": "soy_high_tw",
        "name": "High test weight soybean",
        "density": 825
      },
      {
        "id": "soy_clean",
        "name": "Clean soybean",
        "density": 800
      },
      {
        "id": "soy_impurities",
        "name": "Soybean with impurities",
        "density": 720
      },
      {
        "id": "soy_food",
        "name": "Food soybean",
        "density": 780
      },
      {
        "id": "soy_feed",
        "name": "Feed soybean",
        "density": 750
      },
      {
        "id": "soy_dry",
        "name": "Dry dense soybean",
        "density": 810
      },
      {
        "id": "soy_harvest",
        "name": "Harvest average soybean",
        "density": 760
      },
      {
        "id": "soy_round",
        "name": "Round soybean",
        "density": 780
      },
      {
        "id": "soy_flat",
        "name": "Flat soybean",
        "density": 745
      },
      {
        "id": "soy_early",
        "name": "Early soybean",
        "density": 755
      },
      {
        "id": "soy_late",
        "name": "Late soybean",
        "density": 775
      }
    ]
  },
  "sunflower": {
    "name": "Sunflower",
    "defaultProfile": "sun_avg",
    "baseMoisture": 10,
    "tolerance": 0.08,
    "profiles": [
      {
        "id": "sun_oil_avg",
        "name": "Average oil sunflower",
        "density": 386
      },
      {
        "id": "sun_oil_light",
        "name": "Light oil sunflower",
        "density": 340
      },
      {
        "id": "sun_oil_below",
        "name": "Below-average sunflower",
        "density": 360
      },
      {
        "id": "sun_oil_standard",
        "name": "Standard sunflower",
        "density": 385
      },
      {
        "id": "sun_oil_dense",
        "name": "Dense sunflower",
        "density": 420
      },
      {
        "id": "sun_oil_very_dense",
        "name": "Very dense sunflower",
        "density": 460
      },
      {
        "id": "sun_confection",
        "name": "Confection sunflower",
        "density": 322
      },
      {
        "id": "sun_large",
        "name": "Large-seed sunflower",
        "density": 330
      },
      {
        "id": "sun_small",
        "name": "Small-seed sunflower",
        "density": 405
      },
      {
        "id": "sun_low_tw",
        "name": "Low test weight sunflower",
        "density": 315
      },
      {
        "id": "sun_high_tw",
        "name": "High test weight sunflower",
        "density": 470
      },
      {
        "id": "sun_clean",
        "name": "Clean sunflower",
        "density": 420
      },
      {
        "id": "sun_impurities",
        "name": "Sunflower with impurities",
        "density": 350
      },
      {
        "id": "sun_black",
        "name": "Black oil sunflower",
        "density": 390
      },
      {
        "id": "sun_striped",
        "name": "Striped sunflower",
        "density": 330
      },
      {
        "id": "sun_dry",
        "name": "Dry dense sunflower",
        "density": 440
      },
      {
        "id": "sun_harvest",
        "name": "Harvest average sunflower",
        "density": 375
      },
      {
        "id": "sun_hybrid",
        "name": "Average hybrid sunflower",
        "density": 395
      },
      {
        "id": "sun_high_oil",
        "name": "High-oil sunflower",
        "density": 385
      },
      {
        "id": "sun_low_oil",
        "name": "Low-oil sunflower",
        "density": 370
      }
    ]
  },
  "mustard": {
    "name": "Mustard",
    "defaultProfile": "mustard_avg",
    "baseMoisture": 9.5,
    "tolerance": 0.07,
    "profiles": [
      {
        "id": "mustard_avg",
        "name": "Average mustard",
        "density": 644
      },
      {
        "id": "mustard_light",
        "name": "Light mustard",
        "density": 580
      },
      {
        "id": "mustard_below",
        "name": "Below-average mustard",
        "density": 605
      },
      {
        "id": "mustard_standard",
        "name": "Standard mustard",
        "density": 640
      },
      {
        "id": "mustard_dense",
        "name": "Dense mustard",
        "density": 670
      },
      {
        "id": "mustard_very_dense",
        "name": "Very dense mustard",
        "density": 700
      },
      {
        "id": "mustard_yellow",
        "name": "Yellow mustard",
        "density": 650
      },
      {
        "id": "mustard_brown",
        "name": "Brown mustard",
        "density": 635
      },
      {
        "id": "mustard_oriental",
        "name": "Oriental mustard",
        "density": 640
      },
      {
        "id": "mustard_low_tw",
        "name": "Low test weight mustard",
        "density": 570
      },
      {
        "id": "mustard_high_tw",
        "name": "High test weight mustard",
        "density": 710
      },
      {
        "id": "mustard_clean",
        "name": "Clean mustard",
        "density": 675
      },
      {
        "id": "mustard_impurities",
        "name": "Mustard with impurities",
        "density": 600
      },
      {
        "id": "mustard_large",
        "name": "Large-seed mustard",
        "density": 635
      },
      {
        "id": "mustard_small",
        "name": "Small-seed mustard",
        "density": 660
      },
      {
        "id": "mustard_dry",
        "name": "Dry dense mustard",
        "density": 690
      },
      {
        "id": "mustard_harvest",
        "name": "Harvest average mustard",
        "density": 635
      },
      {
        "id": "mustard_food",
        "name": "Food mustard",
        "density": 650
      },
      {
        "id": "mustard_feed",
        "name": "Industrial mustard",
        "density": 625
      },
      {
        "id": "mustard_mixed",
        "name": "Mixed mustard lot",
        "density": 620
      }
    ]
  }
}

export const yieldBenchmarks: Record<CropId, YieldBenchmark> = {
  "wheat": {
    "min": 1.0,
    "average": 3.6,
    "max": 10.0,
    "source": "FAOSTAT/OWID wheat yields"
  },
  "barley": {
    "min": 0.8,
    "average": 3.1,
    "max": 9.0,
    "source": "FAOSTAT/OWID barley yields"
  },
  "corn": {
    "min": 1.2,
    "average": 5.9,
    "max": 12.5,
    "source": "FAOSTAT/OWID maize yields"
  },
  "soybean": {
    "min": 0.7,
    "average": 2.8,
    "max": 4.5,
    "source": "FAOSTAT/OWID soybean yields"
  },
  "sunflower": {
    "min": 0.5,
    "average": 1.8,
    "max": 4.0,
    "source": "FAOSTAT/OWID sunflower seed yields"
  },
  "mustard": {
    "min": 0.4,
    "average": 1.2,
    "max": 3.0,
    "source": "FAOSTAT oilseed/mustard yield references"
  }
}
